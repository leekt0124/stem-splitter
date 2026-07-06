import { useMemo } from 'react'
import type { Analysis } from '../api'

interface Props {
  analysis: Analysis
  duration: number
  position: number
  onSeek: (t: number) => void
}

/** Chord blocks with a beat-tick ruler underneath, in song-time coordinates. */
export default function Timeline({ analysis, duration, position, onSeek }: Props) {
  const pct = (t: number) => `${(t / duration) * 100}%`

  const seekFromEvent = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onSeek(((e.clientX - rect.left) / rect.width) * duration)
  }

  // thin out ticks if the song has a huge number of beats
  const beats = useMemo(() => {
    const step = Math.ceil(analysis.beats.length / 600)
    return analysis.beats.filter((_, i) => i % step === 0)
  }, [analysis.beats])

  const current = analysis.chords.find((c) => position >= c.start && position < c.end)

  return (
    <div className="timeline" onClick={seekFromEvent}>
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
  )
}
