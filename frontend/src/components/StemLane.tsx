import Waveform from './Waveform'
import { STEM_COLORS, STEM_ICONS } from '../stems'

interface Props {
  name: string
  buffer: AudioBuffer
  volume: number
  muted: boolean
  solo: boolean
  audible: boolean
  progress: number
  downloadUrl: string
  onVolume: (v: number) => void
  onToggleMute: () => void
  onToggleSolo: () => void
  onSeek: (fraction: number) => void
  onScore?: () => void
  scoreOpen?: boolean
}

export default function StemLane(p: Props) {
  const color = STEM_COLORS[p.name] ?? '#94a3b8'
  return (
    <div className="lane" style={{ borderLeftColor: color }}>
      <div className="lane-controls">
        <div className="lane-title">
          <span>{STEM_ICONS[p.name] ?? '🎵'}</span>
          <span style={{ color }}>{p.name}</span>
        </div>
        <div className="lane-buttons">
          <button
            className={`chip ${p.muted ? 'chip-active-mute' : ''}`}
            title="Mute"
            onClick={p.onToggleMute}
          >
            M
          </button>
          <button
            className={`chip ${p.solo ? 'chip-active-solo' : ''}`}
            title="Solo"
            onClick={p.onToggleSolo}
          >
            S
          </button>
          <a className="chip" title="Download stem" href={p.downloadUrl} download={`${p.name}.wav`}>
            ⬇
          </a>
          {p.onScore && (
            <button
              className={`chip ${p.scoreOpen ? 'chip-active-solo' : ''}`}
              title="Sheet music (auto-transcribed)"
              onClick={p.onScore}
            >
              ♪
            </button>
          )}
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={p.volume}
          style={{ accentColor: color }}
          onChange={(e) => p.onVolume(Number(e.target.value))}
        />
      </div>
      <Waveform
        buffer={p.buffer}
        color={color}
        progress={p.progress}
        dimmed={!p.audible}
        onSeek={p.onSeek}
      />
    </div>
  )
}
