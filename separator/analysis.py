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
    import scipy.ndimage

    # sum the non-drum stems into one "harmony" signal
    signals = [librosa.load(p, sr=SR, mono=True)[0] for p in harmonic_paths]
    length = max(len(s) for s in signals)
    y = np.zeros(length, dtype=np.float32)
    for s in signals:
        y[: len(s)] += s

    chroma = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=CHROMA_HOP)
    # median-filter over time: suppresses melody notes and transients that
    # don't belong to the underlying harmony
    chroma = scipy.ndimage.median_filter(chroma, size=(1, 5), mode="nearest")

    labels, templates = _chord_templates()

    # cosine similarity between chroma frames and chord templates, sharpened
    # with a softmax so Viterbi sees a real contrast between candidates
    # (raw similarities of related chords, e.g. C vs Am, differ only slightly)
    tn = templates / (np.linalg.norm(templates, axis=1, keepdims=True) + 1e-9)
    cn = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-9)
    sim = tn @ cn
    BETA = 15.0
    prob = np.exp(BETA * (sim - sim.max(axis=0, keepdims=True)))

    # energy gate: quiet frames are "no chord" (label N, index 0),
    # regardless of what noise-floor chroma looks like
    rms = librosa.feature.rms(y=y, frame_length=CHROMA_HOP, hop_length=CHROMA_HOP)[0]
    n_frames = min(prob.shape[1], len(rms))
    prob = prob[:, :n_frames]
    rms_db = 20 * np.log10(rms[:n_frames] + 1e-10)
    quiet = rms_db < max(rms_db.max() - 40, -60)
    prob[0, :] = 1e-6
    prob[0, quiet] = 1e6
    prob /= prob.sum(axis=0, keepdims=True)

    # Viterbi smoothing: strongly prefer staying on the same chord
    n = len(labels)
    transition = np.full((n, n), 0.05 / (n - 1))
    np.fill_diagonal(transition, 0.95)
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
