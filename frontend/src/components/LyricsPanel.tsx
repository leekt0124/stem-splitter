import { useEffect, useRef } from 'react'
import type { LyricLine } from '../api'

interface Props {
  lines: LyricLine[]
  position: number
  onSeek: (t: number) => void
}

/** Scrolling lyrics synced to the playhead; click a line to jump there. */
export default function LyricsPanel({ lines, position, onSeek }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const current = lines.findIndex((l) => position >= l.start && position < l.end)

  useEffect(() => {
    if (current < 0) return
    listRef.current
      ?.querySelector('.lyric-current')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [current])

  return (
    <div className="lyrics" ref={listRef}>
      {lines.map((l, i) => (
        <div
          key={i}
          className={`lyric-line ${i === current ? 'lyric-current' : ''} ${
            i < current ? 'lyric-past' : ''
          }`}
          onClick={() => onSeek(l.start)}
        >
          {l.text}
        </div>
      ))}
    </div>
  )
}
