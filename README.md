# 🎛️ Stem Splitter

Split any song into stems — vocals, drums, bass, guitar, piano — using
[Demucs v4](https://github.com/facebookresearch/demucs) (Meta's hybrid
transformer source-separation model), wrapped in a simple web UI.

![demo](docs/demo.gif)

*The stem mixer: solo the vocals, mute the drums, ride the bass fader, click a waveform to seek — all stems stay in sample-accurate sync.*

## Features

- 🎤 4-stem separation (vocals / drums / bass / other) with `htdemucs_ft`
- 🎸 6-stem mode (adds guitar and piano) with `htdemucs_6s`
- 🎚️ Web-based stem mixer: per-stem volume / mute / solo, synced waveforms, click-to-seek, per-stem download
- 💾 Export your adjusted mix as wav — rendered instantly in the browser
- 🔒 Runs fully locally — your audio never leaves your machine
- ⚡ GPU-accelerated when CUDA is available (a 3-minute song separates in seconds on a modern GPU, a few minutes on CPU)

## Quickstart

Requires Python ≥ 3.10, [ffmpeg](https://ffmpeg.org/) on your PATH, and Node ≥ 18 (only to build the mixer frontend).

```bash
git clone https://github.com/leekt0124/stem-splitter.git
cd stem-splitter
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# build the mixer frontend once
(cd frontend && npm install && npm run build)

uvicorn api:app --port 8000
```

Open http://localhost:8000, drop in a song, and mix.
Model weights (~300 MB–1 GB depending on the model) are downloaded
automatically on first use and cached under `~/.cache/torch`.

There is also a simpler Gradio UI (no Node needed): `python app.py` → http://localhost:7860.

## REST API

The FastAPI server that powers the mixer is also usable directly:

```bash
# submit a job
curl -X POST localhost:8000/api/separate -F "file=@song.mp3" -F "model=htdemucs_ft"
# -> {"job_id": "9954a4b415d9"}

curl localhost:8000/api/jobs/9954a4b415d9            # poll: queued / running / done
curl -O localhost:8000/api/jobs/9954a4b415d9/stems/vocals   # download a stem
```

## How it works

```
frontend/ (React stem mixer)     app.py (Gradio UI)
   Web Audio GainNode per stem        │
        │ REST                        │
   api.py (FastAPI, async jobs) ──────┤
                                      │
                        separator/  (framework-independent core)
                             └── demucs  →  one wav per stem in output/<song>/<model>/
```

The mixer decodes each stem into an `AudioBuffer` and plays them through
per-stem `GainNode`s on one `AudioContext` clock, so solo/mute/volume are
instant and everything stays in sync.

## Roadmap

- [x] Gradio MVP: upload → separate → play/download stems
- [x] FastAPI backend (async jobs, stem download API)
- [x] React stem mixer: synchronized playback, solo/mute/volume, waveforms, seek
- [x] Export the adjusted mix as wav (rendered in-browser with OfflineAudioContext)
- [ ] Pitch shift / time stretch
- [ ] Beat grid + metronome, chord detection
- [ ] Lyrics transcription (Whisper on the vocal stem)

## Acknowledgements

- [Demucs](https://github.com/facebookresearch/demucs) by Meta AI Research (MIT)
- Inspired by [Moises](https://moises.ai/)

## License

MIT — see [LICENSE](LICENSE).
