"""Core stem separation logic.

Kept independent of any UI framework so the Gradio app (Phase 1) and the
FastAPI backend (Phase 2) can share it.
"""

import contextlib
import os
import threading
from pathlib import Path
from typing import Callable

import torch
from demucs.apply import BagOfModels, apply_model
from demucs.audio import AudioFile, save_audio
from demucs.pretrained import get_model

# TF32 matmul on Ampere+ GPUs: ~1.3-2x faster transformer layers with
# accuracy far above audio requirements (demucs was trained in float32,
# but separation quality is insensitive at this precision).
if torch.cuda.is_available():
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

# model name -> short description shown in the UI
MODELS = {
    "htdemucs_6s": "6 stems (vocals / drums / bass / guitar / piano / other)",
    "htdemucs_ft": "4 stems (vocals / drums / bass / other) — highest quality",
    "htdemucs": "4 stems — fastest",
}

DEFAULT_MODEL = "htdemucs_6s"


def default_model() -> str:
    """htdemucs_6s everywhere: it's a single model, so it's as cheap as
    htdemucs even on CPU (unlike the 4-model htdemucs_ft bag)."""
    return DEFAULT_MODEL

# Loading a model takes a few seconds (htdemucs_ft is a bag of 4 models),
# so keep one loaded model per name for the lifetime of the process.
_models: dict[str, torch.nn.Module] = {}
_models_lock = threading.Lock()


def _cuda_devices() -> list[str]:
    return [f"cuda:{i}" for i in range(torch.cuda.device_count())]


def _get_model(model_name: str):
    if model_name not in MODELS:
        raise ValueError(f"Unknown model {model_name!r}, expected one of {list(MODELS)}")
    with _models_lock:
        if model_name not in _models:
            model = get_model(model_name)
            model.eval()
            # park each (sub-)model on its GPU once, instead of demucs's
            # default CPU->GPU->CPU shuffle on every job
            devices = _cuda_devices()
            if devices:
                subs = model.models if isinstance(model, BagOfModels) else [model]
                for i, sub in enumerate(subs):
                    sub.to(devices[i % len(devices)])
            _models[model_name] = model
        return _models[model_name]


@contextlib.contextmanager
def _capture_progress(total_cycles: int, callback: Callable[[float], None]):
    """Report demucs's per-segment progress as one 0..1 fraction.

    demucs only exposes progress through the tqdm bar it wraps around its
    segment loop (one bar per model per shift), so we swap in a shim that
    counts iterations across all bars instead of drawing anything. Bars may
    run concurrently (sub-models on different GPUs), so each bar tracks its
    own fraction and the overall value is their sum.
    """
    import demucs.apply as _apply

    real_tqdm = _apply.tqdm
    lock = threading.Lock()
    fracs: dict[int, float] = {}
    next_id = iter(range(1_000_000))

    class _Shim:
        @staticmethod
        def tqdm(iterable, **_kwargs):
            with lock:
                bar_id = next(next_id)
            items = list(iterable)
            total = max(len(items), 1)
            for i, item in enumerate(items):
                yield item
                with lock:
                    fracs[bar_id] = (i + 1) / total
                    overall = sum(fracs.values()) / total_cycles
                callback(min(overall, 1.0))

    _apply.tqdm = _Shim
    try:
        yield
    finally:
        _apply.tqdm = real_tqdm


def _apply_bag_multi_gpu(
    model: BagOfModels, wav: torch.Tensor, show_progress: bool
) -> torch.Tensor:
    """Run a bag's sub-models across all GPUs in parallel.

    Replicates the weighted average demucs.apply.apply_model computes for
    BagOfModels, but with one worker thread per GPU instead of a serial loop.
    """
    devices = _cuda_devices()
    per_device: dict[str, list[tuple[torch.nn.Module, list[float]]]] = {d: [] for d in devices}
    for i, (sub, weights) in enumerate(zip(model.models, model.weights)):
        per_device[devices[i % len(devices)]].append((sub, weights))

    results: list[tuple[torch.Tensor, list[float]]] = []
    errors: list[Exception] = []
    lock = threading.Lock()

    def worker(device: str, items):
        try:
            for sub, weights in items:
                out = apply_model(
                    sub, wav[None], device=device, split=True, progress=show_progress
                )[0].cpu()
                with lock:
                    results.append((out, weights))
        except Exception as exc:  # surface worker failures to the caller
            with lock:
                errors.append(exc)

    threads = [
        threading.Thread(target=worker, args=(d, items)) for d, items in per_device.items()
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        raise errors[0]

    estimates = torch.zeros_like(results[0][0])
    totals = [0.0] * len(model.sources)
    for out, weights in results:
        for k, inst_weight in enumerate(weights):
            estimates[k] += out[k] * inst_weight
            totals[k] += inst_weight
    for k, total in enumerate(totals):
        estimates[k] /= total
    return estimates


def separate(
    audio_path: str | Path,
    model_name: str = DEFAULT_MODEL,
    out_dir: str | Path = "output",
    device: str | None = None,
    show_progress: bool = True,
    progress_callback: Callable[[float], None] | None = None,
) -> dict[str, Path]:
    """Split ``audio_path`` into stems and write one wav per stem.

    With ``show_progress`` a tqdm bar tracks separation (the Gradio UI picks
    it up via ``gr.Progress(track_tqdm=True)``). ``progress_callback``
    instead receives fractions in [0, 1] and suppresses the console bar.

    Returns ``{stem_name: path_to_wav}``.
    """
    audio_path = Path(audio_path)
    model = _get_model(model_name)
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    wav = AudioFile(audio_path).read(
        streams=0, samplerate=model.samplerate, channels=model.audio_channels
    )
    # demucs expects a normalized mix; undo the normalization on the outputs
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()

    if progress_callback is not None:
        cycles = len(model.models) if isinstance(model, BagOfModels) else 1
        capture = _capture_progress(cycles, progress_callback)
    else:
        capture = contextlib.nullcontext()

    want_bar = show_progress or progress_callback is not None
    multi_gpu = (
        isinstance(model, BagOfModels)
        and len(model.models) > 1
        and len(_cuda_devices()) > 1
        and device.startswith("cuda")
    )
    # On CPU, torch's intra-op parallelism doesn't saturate the cores;
    # letting demucs pipeline segments across a small thread pool measured
    # ~3x faster on a 24-core machine. Ignored on GPU (demucs only pools
    # when device is cpu).
    cpu_workers = min(4, max(1, (os.cpu_count() or 4) // 4))
    with capture:
        if multi_gpu:
            sources = _apply_bag_multi_gpu(model, wav, show_progress=want_bar)
        else:
            sources = apply_model(
                model,
                wav[None],
                device=device,
                split=True,
                progress=want_bar,
                num_workers=cpu_workers,
            )[0]
    sources = sources * ref.std() + ref.mean()

    stem_dir = Path(out_dir) / audio_path.stem / model_name
    stem_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for stem, waveform in zip(model.sources, sources):
        stem_path = stem_dir / f"{stem}.wav"
        save_audio(waveform.cpu(), str(stem_path), samplerate=model.samplerate)
        paths[stem] = stem_path
    return paths
