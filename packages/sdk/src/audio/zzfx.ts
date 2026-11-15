import type { AudioBuses, BusName } from './context.js';

export interface ZzfxOptions {
  vol?: number;
  bus?: BusName;
}

export class ZzfxPlayer {
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly sources = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly context: AudioContext,
    private readonly buses: AudioBuses,
    private readonly random: () => number,
  ) {}

  play(params: number[], options: ZzfxOptions = {}): void {
    if (this.context.state !== 'running') return;
    const key = JSON.stringify(params);
    let buffer = this.cache.get(key);
    if (!buffer) {
      const samples = generateZzfx(params, this.random);
      buffer = this.context.createBuffer(1, samples.length, 44_100);
      buffer.getChannelData(0).set(samples);
      this.cache.set(key, buffer);
    }

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.value = options.vol ?? 1;
    source.connect(gain).connect(this.buses[options.bus ?? 'sfx']);
    source.start();
    this.sources.add(source);
    source.addEventListener?.('ended', () => this.sources.delete(source), { once: true });
  }

  stopAll(): void {
    for (const source of this.sources) source.stop();
    this.sources.clear();
  }
}

// Adapted from zzfx@1.4.0's MIT-licensed buildSamples. The package entry point creates its own
// AudioContext at import time, so keeping the generator here preserves the SDK's one-context invariant.
export function generateZzfx(values: number[], random: () => number): Float32Array {
  const volume = values[0] ?? 1;
  const randomness = values[1] ?? 0.05;
  let frequency = values[2] ?? 220;
  let attack = values[3] ?? 0;
  let sustain = values[4] ?? 0;
  let release = values[5] ?? 0.1;
  const shape = values[6] ?? 0;
  const shapeCurve = values[7] ?? 1;
  let slide = values[8] ?? 0;
  let deltaSlide = values[9] ?? 0;
  let pitchJump = values[10] ?? 0;
  let pitchJumpTime = values[11] ?? 0;
  let repeatTime = values[12] ?? 0;
  const noise = values[13] ?? 0;
  let modulation = values[14] ?? 0;
  const bitCrush = values[15] ?? 0;
  let delay = values[16] ?? 0;
  const sustainVolume = values[17] ?? 1;
  let decay = values[18] ?? 0;
  const tremolo = values[19] ?? 0;
  const filter = values[20] ?? 0;
  const rate = 44_100;
  const tau = Math.PI * 2;
  const absolute = Math.abs;
  const sign = (value: number) => (value < 0 ? -1 : 1);
  const startSlide = (slide *= (500 * tau) / rate ** 2);
  let startFrequency = (frequency *= (1 + randomness * 2 * random() - randomness) * (tau / rate));
  const filterSign = sign(filter);
  const filterW = (tau * absolute(filter) * 2) / rate;
  const filterCos = Math.cos(filterW);
  const filterAlpha = Math.sin(filterW) / 4;
  const filterA0 = 1 + filterAlpha;
  const filterA1 = (-2 * filterCos) / filterA0;
  const filterA2 = (1 - filterAlpha) / filterA0;
  const filterB0 = (1 + filterSign * filterCos) / 2 / filterA0;
  const filterB1 = -(filterSign + filterCos) / filterA0;
  const filterB2 = filterB0;
  attack = attack * rate || 9;
  decay *= rate;
  sustain *= rate;
  release *= rate;
  delay *= rate;
  deltaSlide *= (500 * tau) / rate ** 3;
  modulation *= tau / rate;
  pitchJump *= tau / rate;
  pitchJumpTime *= rate;
  repeatTime = (repeatTime * rate) | 0;

  const length = (attack + decay + sustain + release + delay) | 0;
  const samples = new Float32Array(Math.max(0, length));
  let phase = 0;
  let modulationPhase = 0;
  let repeat = 0;
  let crush = 0;
  let jump = 1;
  let sample = 0;
  let filterX2 = 0;
  let filterX1 = 0;
  let filterY2 = 0;
  let filterY1 = 0;
  for (let index = 0; index < length; index += 1) {
    if (!(++crush % ((bitCrush * 100) | 0))) {
      sample = waveform(shape, phase, shapeCurve);
      const envelope = envelopeAt(index, { attack, decay, sustain, release, delay, length, sustainVolume });
      const shaped = shape > 4 ? sample : sign(sample) * absolute(sample) ** shapeCurve;
      sample = (repeatTime ? 1 - tremolo + tremolo * Math.sin((tau * index) / repeatTime) : 1) * shaped * envelope;
      if (delay) {
        const delayed =
          delay > index
            ? 0
            : (index < length - delay ? 1 : (length - index) / delay) * (samples[(index - delay) | 0]! / 2 / volume);
        sample = sample / 2 + delayed;
      }
      if (filter) {
        sample = filterY1 =
          filterB2 * filterX2 +
          filterB1 * (filterX2 = filterX1) +
          filterB0 * (filterX1 = sample) -
          filterA2 * filterY2 -
          filterA1 * (filterY2 = filterY1);
      }
    }
    samples[index] = sample * volume;
    const step = (frequency += slide += deltaSlide) * Math.cos(modulation * modulationPhase++);
    phase += step + step * noise * (((index * index * tau) % 2) - 1);
    if (jump && ++jump > pitchJumpTime) {
      frequency += pitchJump;
      startFrequency += pitchJump;
      jump = 0;
    }
    if (repeatTime && !(++repeat % repeatTime)) {
      frequency = startFrequency;
      slide = startSlide;
      jump ||= 1;
    }
  }
  return samples;
}

function waveform(shape: number, phase: number, curve: number): number {
  switch (shape) {
    case 0:
      return Math.sin(phase);
    case 1:
      return 1 - 4 * Math.abs(Math.round(phase / (Math.PI * 2)) - phase / (Math.PI * 2));
    case 2:
      return 1 - (((2 * phase) / (Math.PI * 2) + 2) % 2);
    case 3:
      return Math.max(-1, Math.min(1, Math.tan(phase)));
    case 4:
      return Math.sin(phase ** 3);
    default: {
      const cycle = (phase / (Math.PI * 2)) % 1;
      return cycle < curve / 2 ? 1 : -1;
    }
  }
}

interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  delay: number;
  length: number;
  sustainVolume: number;
}

function envelopeAt(index: number, envelope: Envelope): number {
  if (index < envelope.attack) return index / envelope.attack;
  if (index < envelope.attack + envelope.decay) {
    return 1 - ((index - envelope.attack) / envelope.decay) * (1 - envelope.sustainVolume);
  }
  if (index < envelope.attack + envelope.decay + envelope.sustain) return envelope.sustainVolume;
  if (index < envelope.length - envelope.delay) {
    return ((envelope.length - index - envelope.delay) / envelope.release) * envelope.sustainVolume;
  }
  return 0;
}
