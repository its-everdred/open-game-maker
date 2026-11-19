import { vi } from 'vitest';

// A minimal Web Audio context for jsdom: enough for lib/sound to build its graph and for tests to read gains.
export const gain = () => ({
  gain: { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() },
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const source = () => ({
  buffer: null as unknown,
  loop: false,
  loopStart: 0,
  loopEnd: 0,
  playbackRate: { value: 1 },
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
});

export class FakeAudioContext extends EventTarget {
  static last: FakeAudioContext | null = null;
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  sources: ReturnType<typeof source>[] = [];
  gains: ReturnType<typeof gain>[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
  });
  suspend = vi.fn(async () => {
    this.state = 'suspended';
    this.dispatchEvent(new Event('statechange'));
  });
  createGain = () => {
    const g = gain();
    this.gains.push(g);
    return g;
  };
  createMediaElementSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  createBufferSource = () => {
    const s = source();
    this.sources.push(s);
    return s;
  };
  createBuffer = () => ({});
  decodeAudioData = vi.fn(async () => ({ duration: 1 }));

  constructor() {
    super();
    FakeAudioContext.last = this;
  }
}

export function installFakeAudio(): void {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  (navigator as unknown as { audioSession: { type: string } }).audioSession = { type: 'auto' };
}
