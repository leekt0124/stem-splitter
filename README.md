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

## How it works

```
app.py (Gradio UI)
   └── separator/  (framework-independent core)
          └── demucs.api.Separator  →  one wav per stem in output/<song>/<model>/
```

The separation core is deliberately UI-agnostic so a future FastAPI backend
and custom stem-mixer frontend can reuse it unchanged.

## Roadmap

- [x] Gradio MVP: upload → separate → play/download stems
- [ ] FastAPI backend (async jobs, progress API)
- [ ] Custom web frontend: synchronized multi-stem mixer (solo/mute/volume, waveforms)
- [ ] Pitch shift / time stretch
- [ ] Beat grid + metronome, chord detection
- [ ] Lyrics transcription (Whisper on the vocal stem)

## Acknowledgements

- [Demucs](https://github.com/facebookresearch/demucs) by Meta AI Research (MIT)
- Inspired by [Moises](https://moises.ai/)

## License

MIT — see [LICENSE](LICENSE).
