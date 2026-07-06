import type { StretchNode } from 'signalsmith-stretch'
import { encodeWav } from './wav'

// The library is loaded at runtime from public/ as UNTRANSFORMED source
// (see the `vendor` npm script): it builds its AudioWorklet by stringifying
// its own code, which breaks if the bundler rewrites/minifies it.
type StretchFactory = typeof import('signalsmith-stretch').default

const STRETCH_MODULE_URL = '/signalsmith-stretch.mjs'

let stretchFactory: Promise<StretchFactory> | null = null
const SignalsmithStretch = (ctx: BaseAudioContext): Promise<StretchNode> => {
  stretchFactory ??= (
    import(/* @vite-ignore */ STRETCH_MODULE_URL) as Promise<{ default: StretchFactory }>
  ).then((m) => m.default)
  return stretchFactory.then((create) => create(ctx))
}

/**
 * Plays all stems in sync through one SignalsmithStretch worklet per stem,
 * so playback rate and pitch (semitones) are live controls. All positions
 * and durations are in ORIGINAL song time — rate only changes how fast the
 * playhead moves through it, so waveforms, beats and chords never rescale.
 */
export class StemEngine {
  private ctx = new AudioContext()
  private gains = new Map<string, GainNode>()
  private nodes = new Map<string, StretchNode>()
  private startedAt = 0 // ctx time when playback last (re)started
  private offset = 0 // song position at startedAt, in original seconds
  buffers = new Map<string, AudioBuffer>()
  playing = false
  duration = 0
  rate = 1
  semitones = 0

  // metronome
  beats: number[] = []
  metronomeOn = false
  private clicks: AudioBufferSourceNode[] = []
  private clickBuffer: AudioBuffer
  private metroGain: GainNode

  constructor() {
    this.metroGain = this.ctx.createGain()
    this.metroGain.gain.value = 0.5
    this.metroGain.connect(this.ctx.destination)
    this.clickBuffer = this.makeClick()
  }

  async load(stem: string, url: string): Promise<void> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${stem}: ${res.status}`)
    const buf = await this.ctx.decodeAudioData(await res.arrayBuffer())
    this.buffers.set(stem, buf)
    this.duration = Math.max(this.duration, buf.duration)

    const node = await SignalsmithStretch(this.ctx)
    const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)
    await node.addBuffers([buf.getChannelData(0), right])
    const gain = this.ctx.createGain()
    node.connect(gain)
    gain.connect(this.ctx.destination)
    this.nodes.set(stem, node)
    this.gains.set(stem, gain)
  }

  get position(): number {
    if (!this.playing) return this.offset
    const elapsed = Math.max(0, this.ctx.currentTime - this.startedAt)
    return Math.min(this.offset + elapsed * this.rate, this.duration)
  }

  play(): void {
    if (this.playing || this.nodes.size === 0) return
    void this.ctx.resume()
    if (this.offset >= this.duration) this.offset = 0
    this.scheduleAll(this.offset)
    this.playing = true
    this.scheduleClicks()
  }

  pause(): void {
    if (!this.playing) return
    this.offset = this.position
    for (const node of this.nodes.values()) node.stop()
    this.playing = false
    this.cancelClicks()
  }

  seek(t: number): void {
    const target = Math.max(0, Math.min(t, this.duration))
    if (this.playing) {
      this.cancelClicks()
      this.scheduleAll(target)
      this.scheduleClicks()
    } else {
      this.offset = target
    }
  }

  /** Live pitch/tempo change; playback continues from the current position. */
  setTransform(semitones: number, rate: number): void {
    const pos = this.position // read before rate changes: the getter depends on it
    this.semitones = semitones
    this.rate = rate
    if (this.playing) {
      this.cancelClicks()
      this.scheduleAll(pos)
      this.scheduleClicks()
    }
  }

  setGain(stem: string, value: number): void {
    // short ramp avoids clicks when muting/unmuting
    this.gains.get(stem)?.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
  }

  setMetronome(on: boolean): void {
    this.metronomeOn = on
    this.cancelClicks()
    if (on && this.playing) this.scheduleClicks()
  }

  /** Render all stems at the given gains + current pitch/rate to a wav. */
  async exportMix(gains: Record<string, number>): Promise<Blob> {
    const sampleRate = this.ctx.sampleRate
    const outSeconds = this.duration / this.rate
    const off = new OfflineAudioContext(2, Math.ceil(outSeconds * sampleRate), sampleRate)
    for (const [stem, buf] of this.buffers) {
      const level = gains[stem] ?? 1
      if (level <= 0) continue
      const gain = off.createGain()
      gain.gain.value = level
      gain.connect(off.destination)
      if (this.rate === 1 && this.semitones === 0) {
        const src = off.createBufferSource()
        src.buffer = buf
        src.connect(gain)
        src.start(0)
      } else {
        const node = await SignalsmithStretch(off)
        const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)
        await node.addBuffers([buf.getChannelData(0), right])
        node.connect(gain)
        node.schedule({
          output: 0,
          active: true,
          input: 0,
          rate: this.rate,
          semitones: this.semitones,
        })
      }
    }
    return encodeWav(await off.startRendering())
  }

  dispose(): void {
    this.cancelClicks()
    for (const node of this.nodes.values()) node.stop()
    void this.ctx.close()
  }

  private scheduleAll(fromPosition: number): void {
    const when = this.ctx.currentTime + 0.06
    for (const node of this.nodes.values()) {
      node.schedule({
        output: when,
        active: true,
        input: fromPosition,
        rate: this.rate,
        semitones: this.semitones,
      })
    }
    this.startedAt = when
    this.offset = fromPosition
  }

  private scheduleClicks(): void {
    if (!this.metronomeOn || this.beats.length === 0) return
    for (const beat of this.beats) {
      if (beat <= this.offset) continue
      const src = this.ctx.createBufferSource()
      src.buffer = this.clickBuffer
      src.connect(this.metroGain)
      src.start(this.startedAt + (beat - this.offset) / this.rate)
      this.clicks.push(src)
    }
  }

  private cancelClicks(): void {
    for (const s of this.clicks) {
      try {
        s.stop()
      } catch {
        /* not started yet or already done */
      }
    }
    this.clicks = []
  }

  private makeClick(): AudioBuffer {
    // 30ms decaying 1.6kHz tick
    const sr = this.ctx.sampleRate
    const n = Math.floor(sr * 0.03)
    const buf = this.ctx.createBuffer(1, n, sr)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) {
      data[i] = Math.sin((2 * Math.PI * 1600 * i) / sr) * Math.exp((-5 * i) / n)
    }
    return buf
  }
}
