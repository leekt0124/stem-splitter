"""Post-separation musical analysis: tempo, beat grid, chord timeline.

Runs on the separated stems, which is what makes simple methods work well:
beats are tracked on the isolated drums, chords on everything *except* the
drums (a much cleaner chroma than the full mix).
"""

from pathlib import Path

import numpy as np

SR = 22050
CHROMA_HOP = 4096  # ~186 ms per chord frame

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _chord_templates() -> tuple[list[str], np.ndarray]:
    """24 major/minor triad templates plus a flat no-chord template."""
    labels = ["N"]
    templates = [np.full(12, 1 / 12)]
    for root in range(12):
        for quality, intervals in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            labels.append(NOTE_NAMES[root] + quality)
            t = np.zeros(12)
            t[[(root + i) % 12 for i in intervals]] = 1 / 3
            templates.append(t)
    return labels, np.array(templates)


def _detect_beats(drums_path: Path) -> tuple[float, list[float]]:
    import librosa

    y, sr = librosa.load(drums_path, sr=SR, mono=True)
    tempo, frames = librosa.beat.beat_track(y=y, sr=sr)
    beats = librosa.frames_to_time(frames, sr=sr)
    return float(np.atleast_1d(tempo)[0]), [round(float(b), 3) for b in beats]


def _detect_chords(harmonic_paths: list[Path]) -> list[dict]:
    import librosa

    # sum the non-drum stems into one "harmony" signal
    signals = [librosa.load(p, sr=SR, mono=True)[0] for p in harmonic_paths]
    length = max(len(s) for s in signals)
    y = np.zeros(length, dtype=np.float32)
    for s in signals:
        y[: len(s)] += s

    chroma = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=CHROMA_HOP)
    labels, templates = _chord_templates()

    # frame-wise template similarity -> emission probabilities
    scores = templates @ (chroma / (chroma.sum(axis=0, keepdims=True) + 1e-9))
    prob = scores / (scores.sum(axis=0, keepdims=True) + 1e-9)

    # Viterbi smoothing: strongly prefer staying on the same chord
    n = len(labels)
    transition = np.full((n, n), 0.1 / (n - 1))
    np.fill_diagonal(transition, 0.9)
    states = librosa.sequence.viterbi(prob, transition)

    times = librosa.frames_to_time(np.arange(chroma.shape[1] + 1), sr=SR, hop_length=CHROMA_HOP)
    segments: list[dict] = []
    for i, state in enumerate(states):
        label = labels[state]
        if segments and segments[-1]["label"] == label:
            segments[-1]["end"] = round(float(times[i + 1]), 3)
        else:
            segments.append(
                {"start": round(float(times[i]), 3), "end": round(float(times[i + 1]), 3), "label": label}
            )
    # absorb blips shorter than ~0.4s into the previous segment
    cleaned: list[dict] = []
    for seg in segments:
        if cleaned and seg["end"] - seg["start"] < 0.4:
            cleaned[-1]["end"] = seg["end"]
        else:
            cleaned.append(seg)
    return cleaned


def analyze(stem_paths: dict[str, Path]) -> dict:
    """Analyze separated stems. Returns {tempo, beats, chords}."""
    stem_paths = {k: Path(v) for k, v in stem_paths.items()}
    drums = stem_paths.get("drums")
    harmonic = [p for name, p in stem_paths.items() if name != "drums"]

    tempo, beats = _detect_beats(drums) if drums else (0.0, [])
    chords = _detect_chords(harmonic) if harmonic else []
    return {"tempo": round(tempo, 1), "beats": beats, "chords": chords}
