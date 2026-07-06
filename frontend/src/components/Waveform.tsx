import { useEffect, useMemo, useRef } from 'react'

const BUCKETS = 500

function computePeaks(buffer: AudioBuffer): Float32Array {
  const data = buffer.getChannelData(0)
  const peaks = new Float32Array(BUCKETS)
  const step = Math.floor(data.length / BUCKETS) || 1
  for (let i = 0; i < BUCKETS; i++) {
    let max = 0
    const end = Math.min((i + 1) * step, data.length)
    for (let j = i * step; j < end; j += 8) {
      const v = Math.abs(data[j])
      if (v > max) max = v
    }
    peaks[i] = max
  }
  // normalize so quiet stems are still visible
  const overall = Math.max(...peaks, 0.01)
  return peaks.map((p) => p / overall) as Float32Array
}

interface Props {
  buffer: AudioBuffer
  color: string
  progress: number // 0..1
  dimmed: boolean
  onSeek: (fraction: number) => void
}

export default function Waveform({ buffer, color, progress, dimmed, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaks = useMemo(() => computePeaks(buffer), [buffer])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = width * dpr
    canvas.height = height * dpr
    const g = canvas.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, width, height)

    const mid = height / 2
    const barW = width / BUCKETS
    const playedX = progress * width
    for (let i = 0; i < BUCKETS; i++) {
      const x = i * barW
      const h = Math.max(peaks[i] * (height * 0.9), 1.5)
      g.fillStyle = x <= playedX ? color : 'rgba(255,255,255,0.22)'
      g.globalAlpha = dimmed ? 0.25 : 1
      g.fillRect(x, mid - h / 2, Math.max(barW - 1, 1), h)
    }
  }, [peaks, color, progress, dimmed])

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onSeek((e.clientX - rect.left) / rect.width)
      }}
    />
  )
}
