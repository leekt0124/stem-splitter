"""FastAPI backend for stem separation.

Run with: .venv/bin/uvicorn api:app --port 8000

Job flow: POST /api/separate (multipart upload) -> {job_id}
          GET  /api/jobs/{job_id}              -> status + stem names when done
          GET  /api/jobs/{job_id}/stems/{stem} -> wav download
"""

import shutil
import threading
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from separator import DEFAULT_MODEL, MODELS, separate

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


def _run_job(job_id: str, audio_path: Path, model_name: str) -> None:
    job = jobs[job_id]
    job["status"] = "running"
    try:
        with _gpu_lock:
            stems = separate(
                audio_path, model_name, out_dir=OUTPUT_DIR / job_id, show_progress=False
            )
        job["stems"] = {name: str(path) for name, path in stems.items()}
        job["status"] = "done"
    except Exception as exc:  # surface the failure to the client instead of a stuck job
        job["status"] = "error"
        job["error"] = str(exc)


@app.get("/api/models")
def list_models():
    return {"models": MODELS, "default": DEFAULT_MODEL}


@app.post("/api/separate")
def submit(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
):
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
        "error": job["error"],
    }


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
