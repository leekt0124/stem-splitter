"""Sheet-music transcription for individual stems.

Two stages: Spotify's basic-pitch transcribes the stem to note events
(audio -> pitches/times), then music21 quantizes them against the song's
detected tempo and emits MusicXML for the browser to render. Working on a
*separated stem* is what makes this viable at all — transcription of a full
mix is hopeless, an isolated piano/vocal line is quite good.

The result is a practice aid, not engraving: expressive timing is snapped
to a 16th-note grid and ornaments become approximations.
"""

import io
import threading
from pathlib import Path

# transcription is not meaningful for percussion
UNSCORABLE_STEMS = {"drums"}

MIN_NOTE_SECONDS = 0.08  # drop transcription crumbs
DIVISIONS_PER_BEAT = 4  # quantize to 16th notes

_predict_lock = threading.Lock()  # basic-pitch/onnx session is not thread-safe


def _transcribe(stem_path: Path):
    from basic_pitch.inference import predict

    with _predict_lock:
        _, midi_data, note_events = predict(str(stem_path))
    return midi_data, note_events


def _build_score(note_events, tempo: float, title: str):
    from music21 import chord as m21chord
    from music21 import clef, metadata, meter, note, stream, tempo as m21tempo

    beat = 60.0 / tempo
    grid = beat / DIVISIONS_PER_BEAT

    # quantize onto the 16th grid, in quarterLength units
    quantized: dict[float, list[tuple[int, float]]] = {}
    for start, end, pitch, _amplitude, _bends in note_events:
        if end - start < MIN_NOTE_SECONDS:
            continue
        q_on = round(start / grid)
        q_len = max(round((end - start) / grid), 1)
        offset = q_on / DIVISIONS_PER_BEAT  # quarterLengths
        quantized.setdefault(offset, []).append((int(pitch), q_len / DIVISIONS_PER_BEAT))

    part = stream.Part()
    pitches_all = [p for notes_at in quantized.values() for p, _ in notes_at]
    if pitches_all and sum(pitches_all) / len(pitches_all) < 57:  # below ~A3
        part.append(clef.BassClef())
    part.append(meter.TimeSignature("4/4"))
    part.append(m21tempo.MetronomeMark(number=round(tempo)))

    for offset in sorted(quantized):
        notes_at = quantized[offset]
        if len(notes_at) == 1:
            el = note.Note(notes_at[0][0], quarterLength=notes_at[0][1])
        else:
            length = max(ql for _, ql in notes_at)
            el = m21chord.Chord(sorted({p for p, _ in notes_at}), quarterLength=length)
        part.insert(offset, el)

    score = stream.Score()
    score.metadata = metadata.Metadata(title=title)
    score.append(part)
    return score


def transcribe_stem(stem_path: str | Path, tempo: float, stem_name: str) -> dict:
    """Transcribe one stem. Returns {musicxml, midi (bytes), notes}."""
    stem_path = Path(stem_path)
    midi_data, note_events = _transcribe(stem_path)

    tempo = tempo if tempo and tempo > 0 else 120.0
    score = _build_score(note_events, tempo, f"{stem_name} — auto-transcribed")

    from music21.musicxml.m21ToXml import GeneralObjectExporter

    musicxml = GeneralObjectExporter().parse(score).decode("utf-8")

    midi_buf = io.BytesIO()
    midi_data.write(midi_buf)

    return {
        "musicxml": musicxml,
        "midi": midi_buf.getvalue(),
        "notes": sum(len(i.notes) for i in midi_data.instruments),
    }
