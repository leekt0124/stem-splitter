# --- stage 1: build the React mixer ---
FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN mkdir -p public && npm run build

# --- stage 2: runtime ---
FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --no-deps basic-pitch
COPY api.py app.py ./
COPY separator/ separator/
COPY --from=frontend /build/dist frontend/dist

EXPOSE 8000
# demucs downloads model weights here on first use; mount a volume to keep them
VOLUME ["/root/.cache"]
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
