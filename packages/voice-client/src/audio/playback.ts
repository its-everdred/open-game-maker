import { isRecordingSession } from './session.js';

export interface PcmFrame {
  format: string;
  data_b64: string;
}

type ContextFactory = () => AudioContext;

const PCM_RATES = new Map([
  ['pcm_16000', 16_000],
  ['pcm_24000', 24_000],
  ['pcm_44100', 44_100],
]);

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function preferPlaybackSession() {
  const audioSession = (
    navigator as Navigator & {
      audioSession?: { type: string };
    }
  ).audioSession;
  try {
    // An open microphone needs 'play-and-record'; Safari plays that through the speaker too.
    if (audioSession && !isRecordingSession()) audioSession.type = 'playback';
  } catch {
    // Some browsers expose a read-only draft of the Audio Session API.
  }
}

export class PcmPlayer {
  private context: AudioContext | undefined;
  private current: AudioBufferSourceNode | undefined;
  private readonly queue: PcmFrame[] = [];

  constructor(private readonly contextFactory: ContextFactory = () => new AudioContext()) {}

  async unlock(): Promise<void> {
    preferPlaybackSession();
    const context = this.getContext();
    await context.resume();
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, 22_050);
    source.connect(context.destination);
    source.start();
  }

  enqueue(frame: PcmFrame): void {
    if (!PCM_RATES.has(frame.format)) return;
    this.queue.push(frame);
    if (!this.current) this.playNext();
  }

  stop(): void {
    this.queue.length = 0;
    if (this.current) {
      try {
        this.current.stop();
      } catch {
        // It may already have ended between the state check and stop().
      }
    }
    this.current = undefined;
  }

  close(): void {
    this.stop();
    if (this.context) void this.context.close();
    this.context = undefined;
  }

  private getContext(): AudioContext {
    this.context ??= this.contextFactory();
    return this.context;
  }

  private playNext(): void {
    const frame = this.queue.shift();
    if (!frame) return;
    const rate = PCM_RATES.get(frame.format);
    if (!rate) {
      this.playNext();
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(frame.data_b64);
    } catch {
      this.playNext();
      return;
    }
    if (bytes.byteLength % 2 !== 0) {
      this.playNext();
      return;
    }

    const context = this.getContext();
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const buffer = context.createBuffer(1, samples.length, rate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      channel[index] = samples[index]! / 32_768;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (this.current === source) {
        this.current = undefined;
        this.playNext();
      }
    };
    this.current = source;
    source.start();
  }
}
