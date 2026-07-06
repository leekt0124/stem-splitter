"""Lyrics transcription, run on the separated vocals stem.

Transcribing the isolated vocals instead of the full mix is dramatically
more accurate — the accompaniment is exactly the noise Whisper struggles
with, and separation has already removed it.
"""

import os
from pathlib import Path

# whisper model name; "small" is a good speed/quality tradeoff for lyrics
WHISPER_MODEL = os.environ.get("STEM_WHISPER_MODEL", "small")

_model = None


def _get_model():
    global _model
    if _model is None:
        import torch
        import whisper

        device = "cuda" if torch.cuda.is_available() else "cpu"
        _model = whisper.load_model(WHISPER_MODEL, device=device)
    return _model


def transcribe(vocals_path: str | Path) -> dict:
    """Transcribe a vocals stem. Returns {language, lines: [{start, end, text}]}."""
    model = _get_model()
    result = model.transcribe(
        str(vocals_path),
        fp16=model.device.type == "cuda",
        # each lyric line stands alone; feeding previous text back in makes
        # hallucination loops on instrumental sections much worse
        condition_on_previous_text=False,
    )
    lines = []
    for seg in result["segments"]:
        text = seg["text"].strip()
        # drop hallucinated "lyrics" on instrumental/quiet sections
        if not text or seg.get("no_speech_prob", 0.0) > 0.6:
            continue
        lines.append(
            {"start": round(seg["start"], 2), "end": round(seg["end"], 2), "text": text}
        )
    return {"language": result.get("language"), "lines": lines}
