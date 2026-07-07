export interface JobTimings {
  device: string
  separation_model: string
  whisper_model: string
  separation_s?: number
  analysis_s?: number
  lyrics_s?: number
}

export interface JobStatus {
  job_id: string
  status: 'queued' | 'running' | 'done' | 'error'
  filename: string
  model: string
  stems: string[]
  progress: number
  timings: JobTimings
  error: string | null
}

export interface ModelInfo {
  models: Record<string, string>
  default: string
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json()
}

export const fetchModels = () => fetch('/api/models').then((r) => json<ModelInfo>(r))

export async function submitJob(file: File, model: string): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  form.append('model', model)
  const { job_id } = await fetch('/api/separate', { method: 'POST', body: form }).then((r) =>
    json<{ job_id: string }>(r),
  )
  return job_id
}

export const getJob = (id: string) => fetch(`/api/jobs/${id}`).then((r) => json<JobStatus>(r))

export interface ChordSegment {
  start: number
  end: number
  label: string
}

export interface Analysis {
  tempo: number
  beats: number[]
  chords: ChordSegment[]
}

export const getAnalysis = (id: string) =>
  fetch(`/api/jobs/${id}/analysis`).then((r) =>
    json<{ status: 'pending' | 'done' | 'error'; analysis: Analysis | null }>(r),
  )

export interface LyricLine {
  start: number
  end: number
  text: string
}

export interface Lyrics {
  language: string | null
  lines: LyricLine[]
}

export const getLyrics = (id: string) =>
  fetch(`/api/jobs/${id}/lyrics`).then((r) =>
    json<{ status: 'pending' | 'done' | 'error'; lyrics: Lyrics | null }>(r),
  )

export const stemUrl = (id: string, stem: string) => `/api/jobs/${id}/stems/${stem}`
