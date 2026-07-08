import { useEffect, useMemo, useRef, useState } from 'react'
import type { Analysis } from '../api'

const MAX_ZOOM = 16

interface Props {
  analysis: Analysis
  duration: number
  position: number
  onSeek: (t: number) => void
}

/** Chord blocks with a beat-tick ruler underneath, in song-time coordinates.
 * Zoomable: at zoom > 1 the strip widens and auto-scrolls to follow the
 * playhead, so chord labels stay readable on long songs. */
export default function Timeline({ analysis, duration, position, onSeek }: Props) {
  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)

  const pct = (t: number) => `${(t / duration) * 100}%`

  const seekFromEvent = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onSeek(((e.clientX - rect.left) / rect.width) * duration)
  }

  // keep the playhead centered while it moves (playback or seek)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || zoom === 1 || !duration) return
    const playheadPx = (position / duration) * el.scrollWidth
    el.scrollLeft = Math.max(0, playheadPx - el.clientWidth / 2)
  }, [position, zoom, duration])

  // thin out ticks if the song has a huge number of beats (more shown zoomed in)
  const beats = useMemo(() => {
    const step = Math.ceil(analysis.beats.length / (600 * zoom))
    return analysis.beats.filter((_, i) => i % step === 0)
  }, [analysis.beats, zoom])

  const current = analysis.chords.find((c) => position >= c.start && position < c.end)

  return (
    <div className="timeline-outer">
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline" style={{ width: `${zoom * 100}%` }} onClick={seekFromEvent}>
          <div className="chord-row">
            {analysis.chords.map((c, i) => (
              <div
                key={i}
                className={`chord-block ${c === current ? 'chord-current' : ''} ${
                  c.label === 'N' ? 'chord-none' : ''
                }`}
                style={{ left: pct(c.start), width: pct(c.end - c.start) }}
              >
                {c.label !== 'N' && <span>{c.label}</span>}
              </div>
            ))}
          </div>
          <div className="beat-row">
            {beats.map((b, i) => (
              <div key={i} className="beat-tick" style={{ left: pct(b) }} />
            ))}
          </div>
          <div className="playhead" style={{ left: pct(position) }} />
        </div>
      </div>
      <div className="timeline-zoom" title="Timeline zoom">
        <button
          className="chip"
          disabled={zoom === 1}
          onClick={() => setZoom(Math.max(1, zoom / 2))}
        >
          −
        </button>
        <span className="control-value">{zoom}×</span>
        <button
          className="chip"
          disabled={zoom === MAX_ZOOM}
          onClick={() => setZoom(Math.min(MAX_ZOOM, zoom * 2))}
        >
          +
        </button>
      </div>
    </div>
  )
}
