"""Core stem separation logic.

Kept independent of any UI framework so the Gradio app (Phase 1) and the
FastAPI backend (Phase 2) can share it.
"""

import contextlib
from pathlib import Path
from typing import Callable

import torch
from demucs.apply import BagOfModels, apply_model
from demucs.audio import AudioFile, save_audio
from demucs.pretrained import get_model

# model name -> short description shown in the UI
MODELS = {
    "htdemucs_ft": "4 stems (vocals / drums / bass / other) — fine-tuned, best quality",
    "htdemucs": "4 stems — single model, ~4x faster than ft",
    "htdemucs_6s": "6 stems (adds guitar / piano) — experimental",
}

DEFAULT_MODEL = "htdemucs_ft"

# Loading a model takes a few seconds (htdemucs_ft is a bag of 4 models),
# so keep one loaded model per name for the lifetime of the process.
_models: dict[str, torch.nn.Module] = {}


def _get_model(model_name: str):
    if model_name not in MODELS:
        raise ValueError(f"Unknown model {model_name!r}, expected one of {list(MODELS)}")
    if model_name not in _models:
        model = get_model(model_name)
        model.eval()
        _models[model_name] = model
    return _models[model_name]


@contextlib.contextmanager
def _capture_progress(total_cycles: int, callback: Callable[[float], None]):
    """Report demucs's per-segment progress as one 0..1 fraction.

    demucs only exposes progress through the tqdm bar it wraps around its
    segment loop (one bar per model per shift), so we swap in a shim that
    counts iterations across all bars instead of drawing anything.
    """
    import demucs.apply as _apply

    real_tqdm = _apply.tqdm
    done_cycles = 0

    class _Shim:
        @staticmethod
        def tqdm(iterable, **_kwargs):
            nonlocal done_cycles
            items = list(iterable)
            total = max(len(items), 1)
            for i, item in enumerate(items):
                yield item
                callback(min((done_cycles + (i + 1) / total) / total_cycles, 1.0))
            done_cycles += 1

    _apply.tqdm = _Shim
    try:
        yield
    finally:
        _apply.tqdm = real_tqdm


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
    with capture:
        sources = apply_model(
            model,
            wav[None],
            device=device,
            split=True,
            progress=show_progress or progress_callback is not None,
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
