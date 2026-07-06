import { useEffect, useRef, useState } from 'react'
import Mixer from './components/Mixer'
import { fetchModels, getJob, stemUrl, submitJob, type ModelInfo } from './api'
import { StemEngine } from './engine'

type Phase =
  | { kind: 'idle' }
  | { kind: 'processing'; label: string; progress?: number }
  | { kind: 'ready'; jobId: string; filename: string }
  | { kind: 'error'; message: string }

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [models, setModels] = useState<ModelInfo | null>(null)
  const [model, setModel] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const engineRef = useRef<StemEngine | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchModels()
      .then((m) => {
        setModels(m)
        setModel(m.default)
      })
      .catch((e) => setPhase({ kind: 'error', message: String(e) }))
  }, [])

  const reset = () => {
    engineRef.current?.dispose()
    engineRef.current = null
    setPhase({ kind: 'idle' })
  }

  async function separate(file: File) {
    try {
      setPhase({ kind: 'processing', label: 'Uploading…' })
      const jobId = await submitJob(file, model)

      setPhase({ kind: 'processing', label: 'Separating stems…', progress: 0 })
      let job = await getJob(jobId)
      while (job.status === 'queued' || job.status === 'running') {
        setPhase({
          kind: 'processing',
          label: job.status === 'queued' ? 'Waiting for a free slot…' : 'Separating stems…',
          progress: job.progress,
        })
        await new Promise((r) => setTimeout(r, 1000))
        job = await getJob(jobId)
      }
      if (job.status === 'error') throw new Error(job.error ?? 'separation failed')

      setPhase({ kind: 'processing', label: 'Loading stems into the mixer…' })
      const engine = new StemEngine()
      await Promise.all(job.stems.map((s) => engine.load(s, stemUrl(jobId, s))))
      engineRef.current = engine
      ;(window as unknown as { __engine: StemEngine }).__engine = engine // for e2e tests
      setPhase({ kind: 'ready', jobId, filename: job.filename })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  return (
    <div className="app">
      <header>
        <h1>🎛️ Stem Splitter</h1>
        <p>Split any song into stems — runs locally on your machine</p>
      </header>

      {phase.kind === 'idle' && (
        <div
          className={`dropzone ${dragOver ? 'dropzone-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files[0]
            if (f) void separate(f)
          }}
          onClick={() => fileInput.current?.click()}
        >
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void separate(f)
            }}
          />
          <div className="dropzone-inner">
            <div className="dropzone-icon">🎵</div>
            <div>Drop a song here or click to browse</div>
            {models && (
              <select
                value={model}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setModel(e.target.value)}
              >
                {Object.entries(models.models).map(([name, desc]) => (
                  <option key={name} value={name}>
                    {name} — {desc}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {phase.kind === 'processing' && (
        <div className="status">
          {phase.progress !== undefined ? (
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.round(phase.progress * 100)}%` }}
              />
              <span className="progress-label">{Math.round(phase.progress * 100)}%</span>
            </div>
          ) : (
            <div className="spinner" />
          )}
          <div>{phase.label}</div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="status">
          <div className="error">⚠ {phase.message}</div>
          <button className="chip" onClick={reset}>
            try again
          </button>
        </div>
      )}

      {phase.kind === 'ready' && engineRef.current && (
        <Mixer
          jobId={phase.jobId}
          filename={phase.filename}
          engine={engineRef.current}
          onReset={reset}
        />
      )}
    </div>
  )
}
