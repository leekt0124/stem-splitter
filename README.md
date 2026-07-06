# 🎛️ Stem Splitter

Split any song into stems — vocals, drums, bass, guitar, piano — using
[Demucs v4](https://github.com/facebookresearch/demucs) (Meta's hybrid
transformer source-separation model), wrapped in a simple web UI.

<!-- TODO: replace with a GIF of the app separating a song -->
<!-- ![demo](docs/demo.gif) -->

## Features

- 🎤 4-stem separation (vocals / drums / bass / other) with `htdemucs_ft`
- 🎸 6-stem mode (adds guitar and piano) with `htdemucs_6s`
- 🔒 Runs fully locally — your audio never leaves your machine
- ⚡ GPU-accelerated when CUDA is available (a 4-minute song takes ~15 s on a modern GPU, a few minutes on CPU)

## Quickstart

Requires Python ≥ 3.10 and [ffmpeg](https://ffmpeg.org/) on your PATH.

```bash
git clone https://github.com/leekt0124/stem-splitter.git
cd stem-splitter
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://localhost:7860, upload a song, hit **Separate**.
Model weights (~300 MB–1 GB depending on the model) are downloaded
automatically on first use and cached under `~/.cache/torch`.

## REST API

There is also a FastAPI backend (the base for a custom stem-mixer frontend):

```bash
uvicorn api:app --port 8000
```

```bash
# submit a job
curl -X POST localhost:8000/api/separate -F "file=@song.mp3" -F "model=htdemucs_ft"
# -> {"job_id": "9954a4b415d9"}

curl localhost:8000/api/jobs/9954a4b415d9            # poll: queued / running / done
curl -O localhost:8000/api/jobs/9954a4b415d9/stems/vocals   # download a stem
```

## How it works

```
app.py (Gradio UI)      api.py (FastAPI, async jobs)
        └──────────┬──────────┘
             separator/  (framework-independent core)
                  └── demucs  →  one wav per stem in output/<song>/<model>/
```

The separation core is deliberately UI-agnostic so both frontends (and a
future stem-mixer web app) share it unchanged.

## Roadmap

- [x] Gradio MVP: upload → separate → play/download stems
- [x] FastAPI backend (async jobs, stem download API)
- [ ] Custom web frontend: synchronized multi-stem mixer (solo/mute/volume, waveforms)
- [ ] Pitch shift / time stretch
- [ ] Beat grid + metronome, chord detection
- [ ] Lyrics transcription (Whisper on the vocal stem)

## Acknowledgements

- [Demucs](https://github.com/facebookresearch/demucs) by Meta AI Research (MIT)
- Inspired by [Moises](https://moises.ai/)

## License

MIT — see [LICENSE](LICENSE).
