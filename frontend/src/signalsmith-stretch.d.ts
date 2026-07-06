declare module 'signalsmith-stretch' {
  export interface StretchSchedule {
    output?: number
    active?: boolean
    input?: number
    rate?: number
    semitones?: number
    tonalityHz?: number
    formantSemitones?: number
    formantCompensation?: boolean
    loopStart?: number
    loopEnd?: number
  }

  export interface StretchNode extends AudioWorkletNode {
    schedule(change: StretchSchedule): void
    start(when?: number): void
    stop(when?: number): void
    addBuffers(channels: Float32Array[]): Promise<number>
    dropBuffers(toSeconds?: number): Promise<unknown>
    latency(): number
    inputTime: number
  }

  export default function SignalsmithStretch(
    context: BaseAudioContext,
    channelOptions?: Partial<AudioWorkletNodeOptions>,
  ): Promise<StretchNode>
}

