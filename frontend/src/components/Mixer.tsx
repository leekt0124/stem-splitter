import { useEffect, useRef, useState } from 'react'
import StemLane from './StemLane'
import Timeline from './Timeline'
import LyricsPanel from './LyricsPanel'
import { StemEngine } from '../engine'
import {
  getAnalysis,
  getJob,
  getLyrics,
  stemUrl,
  type Analysis,
  type JobTimings,
  type Lyrics,
} from '../api'
import { sortStems } from '../stems'

const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5]

const fmt = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

interface Props {
  jobId: string
  filename: string
  engine: StemEngine
  onReset: () => void
}

export default function Mixer({ jobId, filename, engine, onReset }: Props) {
  const stems = sortStems([...engine.buffers.keys()])
  const [volumes, setVolumes] = useState<Record<string, number>>(() =>
    Object.fromEntries(stems.map((s) => [s, 1])),
  )
  const [muted, setMuted] = useState<Set<string>>(new Set())
  const [solo, setSolo] = useState<Set<string>>(new Set())
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [semitones, setSemitones] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [metronome, setMetronome] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [lyrics, setLyrics] = useState<Lyrics | null>(null)
  const [showLyrics, setShowLyrics] = useState(true)
  const [timings, setTimings] = useState<JobTimings | null>(null)
  const raf = useRef(0)

  const audible = (s: string) =>
    !muted.has(s) && (solo.size === 0 || solo.has(s)) && volumes[s] > 0

  // push effective gains into the engine whenever the mix changes
  useEffect(() => {
    for (const s of stems) engine.setGain(s, audible(s) ? volumes[s] : 0)
  }, [volumes, muted, solo]) // eslint-disable-line react-hooks/exhaustive-deps

  // poll for tempo/beats/chords and lyrics until the backend finishes
  useEffect(() => {
    let stop = false
    const poll = async () => {
      let wantAnalysis = true
      let wantLyrics = true
      for (let i = 0; i < 150 && !stop && (wantAnalysis || wantLyrics); i++) {
        try {
          if (wantAnalysis) {
            const res = await getAnalysis(jobId)
            if (res.status === 'done' && res.analysis) {
              engine.beats = res.analysis.beats
              setAnalysis(res.analysis)
            }
            if (res.status !== 'pending') wantAnalysis = false
          }
          if (wantLyrics) {
            const res = await getLyrics(jobId)
            if (res.status === 'done' && res.lyrics?.lines.length) setLyrics(res.lyrics)
            if (res.status !== 'pending') wantLyrics = false
          }
        } catch {
          /* server briefly unreachable; retry */
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
      try {
        // all stages settled: grab the final per-stage timings
        if (!stop) setTimings((await getJob(jobId)).timings)
      } catch {
        /* cosmetic only */
      }
    }
    void poll()
    return () => {
      stop = true
    }
  }, [jobId, engine])

  // playhead loop; auto-stop at the end of the song
  useEffect(() => {
    const tick = () => {
      setPosition(engine.position)
      if (engine.playing && engine.position >= engine.duration) {
        engine.pause()
        setPlaying(false)
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [engine])

  const togglePlay = () => {
    if (engine.playing) {
      engine.pause()
      setPlaying(false)
    } else {
      engine.play()
      setPlaying(true)
    }
  }

  const changePitch = (delta: number) => {
    const next = Math.max(-6, Math.min(6, semitones + delta))
    setSemitones(next)
    engine.setTransform(next, speed)
  }

  const changeSpeed = (next: number) => {
    setSpeed(next)
    engine.setTransform(semitones, next)
  }

  const toggleMetronome = () => {
    engine.setMetronome(!metronome)
    setMetronome(!metronome)
  }

  const toggleIn = (set: Set<string>, s: string) => {
    const next = new Set(set)
    next.has(s) ? next.delete(s) : next.add(s)
    return next
  }

  const exportMix = async () => {
    setExporting(true)
    try {
      const gains = Object.fromEntries(stems.map((s) => [s, audible(s) ? volumes[s] : 0]))
      const blob = await engine.exportMix(gains)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename.replace(/\.[^.]+$/, '')}_mix.wav`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const currentChord = analysis?.chords.find((c) => position >= c.start && position < c.end)

  return (
    <div className="mixer">
      <div className="transport">
        <button className="play-btn" onClick={togglePlay}>
          {playing ? '⏸' : '▶'}
        </button>
        <span className="time">
          {fmt(position)} / {fmt(engine.duration)}
        </span>

        <span
          className="control-group"
          title={
            engine.stretchAvailable
              ? 'Pitch shift (semitones)'
              : 'Pitch/speed need a secure context — open the app via localhost or HTTPS'
          }
        >
          <button
            className="chip"
            disabled={!engine.stretchAvailable}
            onClick={() => changePitch(-1)}
          >
            −
          </button>
          <span className="control-value">
            {semitones > 0 ? `+${semitones}` : semitones} st
          </span>
          <button
            className="chip"
            disabled={!engine.stretchAvailable}
            onClick={() => changePitch(1)}
          >
            +
          </button>
        </span>

        <select
          className="speed-select"
          title={
            engine.stretchAvailable
              ? 'Playback speed'
              : 'Pitch/speed need a secure context — open the app via localhost or HTTPS'
          }
          value={speed}
          disabled={!engine.stretchAvailable}
          onChange={(e) => changeSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>

        <button
          className={`chip ${metronome ? 'chip-active-solo' : ''}`}
          onClick={toggleMetronome}
          disabled={!analysis || analysis.beats.length === 0}
          title="Metronome click on detected beats"
        >
          🕐 click
        </button>

        {lyrics && (
          <button
            className={`chip ${showLyrics ? 'chip-active-solo' : ''}`}
            onClick={() => setShowLyrics(!showLyrics)}
            title="Show/hide lyrics (transcribed from the vocal stem)"
          >
            🎤 lyrics
          </button>
        )}

        {analysis && analysis.tempo > 0 && (
          <span className="badge">{Math.round(analysis.tempo)} bpm</span>
        )}
        {currentChord && currentChord.label !== 'N' && (
          <span className="badge badge-chord">{currentChord.label}</span>
        )}

        <span className="song-name" title={filename}>
          {filename}
        </span>
        <button className="chip" onClick={exportMix} disabled={exporting}>
          {exporting ? 'rendering…' : '⬇ export mix'}
        </button>
        <button className="chip" onClick={onReset}>
          ✕ new song
        </button>
      </div>

      {analysis && (
        <Timeline
          analysis={analysis}
          duration={engine.duration}
          position={position}
          onSeek={(t) => engine.seek(t)}
        />
      )}

      {lyrics && showLyrics && (
        <LyricsPanel lines={lyrics.lines} position={position} onSeek={(t) => engine.seek(t)} />
      )}

      {timings?.separation_s !== undefined && (
        <div className="footnote">
          ⏱ separation ({timings.separation_model}) {timings.separation_s}s
          {timings.analysis_s !== undefined && ` · beats/chords ${timings.analysis_s}s`}
          {timings.lyrics_s !== undefined &&
            ` · lyrics (whisper ${timings.whisper_model}) ${timings.lyrics_s}s`}
          {` · ${timings.device}`}
        </div>
      )}

      {stems.map((s) => (
        <StemLane
          key={s}
          name={s}
          buffer={engine.buffers.get(s)!}
          volume={volumes[s]}
          muted={muted.has(s)}
          solo={solo.has(s)}
          audible={audible(s)}
          progress={engine.duration ? position / engine.duration : 0}
          downloadUrl={stemUrl(jobId, s)}
          onVolume={(v) => setVolumes({ ...volumes, [s]: v })}
          onToggleMute={() => setMuted(toggleIn(muted, s))}
          onToggleSolo={() => setSolo(toggleIn(solo, s))}
          onSeek={(f) => engine.seek(f * engine.duration)}
        />
      ))}
    </div>
  )
}
