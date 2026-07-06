import { useEffect, useRef, useState } from 'react'
import StemLane from './StemLane'
import { StemEngine } from '../engine'
import { stemUrl } from '../api'
import { sortStems } from '../stems'

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
  const raf = useRef(0)

  const audible = (s: string) =>
    !muted.has(s) && (solo.size === 0 || solo.has(s)) && volumes[s] > 0

  // push effective gains into the engine whenever the mix changes
  useEffect(() => {
    for (const s of stems) engine.setGain(s, audible(s) ? volumes[s] : 0)
  }, [volumes, muted, solo]) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className="mixer">
      <div className="transport">
        <button className="play-btn" onClick={togglePlay}>
          {playing ? '⏸' : '▶'}
        </button>
        <span className="time">
          {fmt(position)} / {fmt(engine.duration)}
        </span>
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
