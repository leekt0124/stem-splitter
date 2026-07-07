"""FastAPI backend for stem separation.

Run with: .venv/bin/uvicorn api:app --port 8000

Job flow: POST /api/separate (multipart upload) -> {job_id}
          GET  /api/jobs/{job_id}              -> status + stem names when done
          GET  /api/jobs/{job_id}/stems/{stem} -> wav download
"""

import os
import shutil
import threading
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import time

from separator import DEFAULT_MODEL, MODELS, separate
from separator.analysis import analyze
from separator.core import default_model
from separator.lyrics import _model_name as whisper_model_name
from separator.lyrics import transcribe

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("output")
ALLOWED_SUFFIXES = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac"}

app = FastAPI(title="Stem Splitter API")

# permissive CORS so a separately-served dev frontend can talk to us
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# in-memory job registry — fine for a single-process personal app;
# swap for redis/db if this ever needs to scale past one process
jobs: dict[str, dict] = {}
# one separation at a time keeps GPU memory predictable
_gpu_lock = threading.Lock()


def _has_cuda() -> bool:
    import torch

    return torch.cuda.is_available()


@app.on_event("startup")
def _preload_models() -> None:
    """Warm the default demucs model and whisper so the first job is fast.

    Runs in a background thread — the server accepts requests immediately.
    Disable with STEM_PRELOAD=0 (e.g. on low-memory machines).
    """
    if os.environ.get("STEM_PRELOAD", "1") == "0":
        return

    def warm():
        from separator.core import _get_model
        from separator.lyrics import _get_model as _get_whisper

        try:
            _get_model(DEFAULT_MODEL)
            _get_whisper()
        except Exception:
            pass  # first real job will load (and surface) whatever failed

    threading.Thread(target=warm, daemon=True).start()


def _run_job(job_id: str, audio_path: Path, model_name: str) -> None:
    job = jobs[job_id]
    job["status"] = "running"

    def on_progress(frac: float) -> None:
        job["progress"] = round(frac, 3)

    try:
        with _gpu_lock:
            t0 = time.perf_counter()
            stems = separate(
                audio_path,
                model_name,
                out_dir=OUTPUT_DIR / job_id,
                show_progress=False,
                progress_callback=on_progress,
            )
            job["timings"]["separation_s"] = round(time.perf_counter() - t0, 2)
        job["progress"] = 1.0
        job["stems"] = {name: str(path) for name, path in stems.items()}
        job["status"] = "done"
    except Exception as exc:  # surface the failure to the client instead of a stuck job
        job["status"] = "error"
        job["error"] = str(exc)
        return

    # stems are usable now; tempo/beats/chords and lyrics arrive when ready.
    # analysis is CPU-bound and lyrics is GPU-bound, so run them in parallel.
    def run_analysis():
        try:
            t0 = time.perf_counter()
            job["analysis"] = analyze(stems)
            job["timings"]["analysis_s"] = round(time.perf_counter() - t0, 2)
            job["analysis_status"] = "done"
        except Exception as exc:
            job["analysis_status"] = "error"
            job["error"] = f"analysis failed: {exc}"

    def run_lyrics():
        if "vocals" not in stems:
            job["lyrics_status"] = "done"
            return
        try:
            with _gpu_lock:  # whisper shares the GPUs with separation jobs
                t0 = time.perf_counter()
                job["lyrics"] = transcribe(stems["vocals"])
                job["timings"]["lyrics_s"] = round(time.perf_counter() - t0, 2)
            job["lyrics_status"] = "done"
        except Exception as exc:
            job["lyrics_status"] = "error"
            job["error"] = f"lyrics failed: {exc}"

    stages = [threading.Thread(target=run_analysis), threading.Thread(target=run_lyrics)]
    for t in stages:
        t.start()
    for t in stages:
        t.join()


@app.get("/api/models")
def list_models():
    return {"models": MODELS, "default": default_model()}


@app.post("/api/separate")
def submit(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model: str = Form(""),
):
    model = model or default_model()
    if model not in MODELS:
        raise HTTPException(422, f"Unknown model {model!r}, expected one of {list(MODELS)}")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(422, f"Unsupported file type {suffix!r}")

    job_id = uuid.uuid4().hex[:12]
    audio_path = UPLOAD_DIR / job_id / Path(file.filename).name
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    with audio_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    jobs[job_id] = {
        "status": "queued",
        "filename": audio_path.name,
        "model": model,
        "stems": {},
        "error": None,
        "progress": 0.0,
        "analysis": None,
        "analysis_status": "pending",
        "lyrics": None,
        "lyrics_status": "pending",
        "timings": {
            "device": "cuda" if _has_cuda() else "cpu",
            "separation_model": model,
            "whisper_model": whisper_model_name(),
        },
    }
    background_tasks.add_task(_run_job, job_id, audio_path, model)
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "No such job")
    return {
        "job_id": job_id,
        "status": job["status"],
        "filename": job["filename"],
        "model": job["model"],
        "stems": sorted(job["stems"]),
        "progress": job["progress"],
        "timings": job["timings"],
        "error": job["error"],
    }


@app.get("/api/jobs/{job_id}/analysis")
def job_analysis(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "No such job")
    return {"status": job["analysis_status"], "analysis": job["analysis"]}


@app.get("/api/jobs/{job_id}/lyrics")
def job_lyrics(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "No such job")
    return {"status": job["lyrics_status"], "lyrics": job["lyrics"]}


@app.get("/api/jobs/{job_id}/stems/{stem}")
def download_stem(job_id: str, stem: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "No such job")
    path = job["stems"].get(stem.removesuffix(".wav"))
    if path is None:
        raise HTTPException(404, f"No stem {stem!r} for this job")
    return FileResponse(path, media_type="audio/wav", filename=f"{stem}.wav")


# serve the built React mixer, if present (run `npm run build` in frontend/)
_frontend_dist = Path(__file__).parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
