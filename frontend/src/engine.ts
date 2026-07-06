/**
 * Plays all stems in sample-accurate sync: each stem gets its own GainNode,
 * all sources are (re)created from AudioBuffers on play/seek so they share
 * the AudioContext clock.
 */
export class StemEngine {
  private ctx = new AudioContext()
  private gains = new Map<string, GainNode>()
  private sources: AudioBufferSourceNode[] = []
  private startedAt = 0 // ctx time when playback last started
  private offset = 0 // song position when playback last started/paused
  buffers = new Map<string, AudioBuffer>()
  playing = false
  duration = 0

  async load(stem: string, url: string): Promise<void> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${stem}: ${res.status}`)
    const buf = await this.ctx.decodeAudioData(await res.arrayBuffer())
    this.buffers.set(stem, buf)
    const gain = this.ctx.createGain()
    gain.connect(this.ctx.destination)
    this.gains.set(stem, gain)
    this.duration = Math.max(this.duration, buf.duration)
  }

  get position(): number {
    const pos = this.playing ? this.offset + this.ctx.currentTime - this.startedAt : this.offset
    return Math.min(pos, this.duration)
  }

  play(): void {
    if (this.playing || this.buffers.size === 0) return
    void this.ctx.resume()
    if (this.offset >= this.duration) this.offset = 0
    for (const [stem, buf] of this.buffers) {
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      src.connect(this.gains.get(stem)!)
      src.start(0, this.offset)
      this.sources.push(src)
    }
    this.startedAt = this.ctx.currentTime
    this.playing = true
  }

  pause(): void {
    if (!this.playing) return
    this.offset = this.position
    this.stopSources()
    this.playing = false
  }

  seek(t: number): void {
    const wasPlaying = this.playing
    if (wasPlaying) this.stopSources()
    this.playing = false
    this.offset = Math.max(0, Math.min(t, this.duration))
    if (wasPlaying) this.play()
  }

  setGain(stem: string, value: number): void {
    // short ramp avoids clicks when muting/unmuting
    this.gains.get(stem)?.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
  }

  /** Render all stems at the given gains to a single stereo wav, offline. */
  async exportMix(gains: Record<string, number>): Promise<Blob> {
    const sampleRate = this.ctx.sampleRate
    const off = new OfflineAudioContext(2, Math.ceil(this.duration * sampleRate), sampleRate)
    for (const [stem, buf] of this.buffers) {
      const level = gains[stem] ?? 1
      if (level <= 0) continue
      const src = off.createBufferSource()
      src.buffer = buf
      const gain = off.createGain()
      gain.gain.value = level
      src.connect(gain).connect(off.destination)
      src.start(0)
    }
    const { encodeWav } = await import('./wav')
    return encodeWav(await off.startRendering())
  }

  dispose(): void {
    this.stopSources()
    void this.ctx.close()
  }

  private stopSources(): void {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
    }
    this.sources = []
  }
}
