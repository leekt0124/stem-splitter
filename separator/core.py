"""Core stem separation logic.

Kept independent of any UI framework so the Gradio app (Phase 1) and the
FastAPI backend (Phase 2) can share it.
"""

from pathlib import Path

import torch
from demucs.apply import apply_model
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


def separate(
    audio_path: str | Path,
    model_name: str = DEFAULT_MODEL,
    out_dir: str | Path = "output",
    device: str | None = None,
    show_progress: bool = True,
) -> dict[str, Path]:
    """Split ``audio_path`` into stems and write one wav per stem.

    With ``show_progress`` a tqdm bar tracks separation (the Gradio UI picks
    it up via ``gr.Progress(track_tqdm=True)``).

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

    sources = apply_model(
        model, wav[None], device=device, split=True, progress=show_progress
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
