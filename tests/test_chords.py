"""Ground-truth test for the chord detector.

Synthesizes a known progression (2s silence, then C / Am / F / G, 3s each,
with harmonics) and checks the detected segments. Run directly:

    python tests/test_chords.py
"""

import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

TRUTH = [
    ("N", 0.0, 2.0),
    ("C", 2.0, 5.0),
    ("Am", 5.0, 8.0),
    ("F", 8.0, 11.0),
    ("G", 11.0, 14.0),
]


def synth_progression(sr: int = 22050) -> np.ndarray:
    import librosa

    chords = [["C4", "E4", "G4"], ["A3", "C4", "E4"], ["F3", "A3", "C4"], ["G3", "B3", "D4"]]
    parts = [np.zeros(2 * sr, dtype=np.float32)]
    t = np.arange(3 * sr) / sr
    env = np.minimum(1, np.minimum(t / 0.02, (3 - t) / 0.05)).astype(np.float32)
    for notes in chords:
        seg = np.zeros(3 * sr, dtype=np.float32)
        for note in notes:
            f = librosa.note_to_hz(note)
            for h, amp in enumerate([1.0, 0.5, 0.33, 0.25], start=1):
                seg += amp * np.sin(2 * np.pi * f * h * t).astype(np.float32)
        parts.append(seg * env * 0.1)
    return np.concatenate(parts)


def test_chord_progression():
    import soundfile as sf

    from separator.analysis import _detect_chords

    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "progression.wav"
        sf.write(path, synth_progression(), 22050)
        segments = _detect_chords([path])

    assert [s["label"] for s in segments] == [label for label, _, _ in TRUTH], segments
    for seg, (label, start, end) in zip(segments, TRUTH):
        assert abs(seg["start"] - start) < 0.5, (label, seg)
        assert abs(seg["end"] - end) < 0.5, (label, seg)


if __name__ == "__main__":
    test_chord_progression()
    print("test_chord_progression OK")
