import type { AudioStatus } from './unlock.js';
import { trailerCapture } from './trailer.js';
import { groupSentences, splitSentences, type AlignmentSegment, type TimedSentence } from './sentences.js';

export type SpokenTextEntry = { key: string; audioUrl: string; alignmentUrl: string };
export type SpokenTextOptions = {
  onSentence?: (index: number, sentence: string) => void;
  onEnd?: () => void;
  bus?: 'voice';
};
export type SpokenTextHandle = { cancel(): void };

type AudioRuntime = { context: AudioContext; voice: GainNode; status(): AudioStatus };
type RenderedData = { bytes: ArrayBuffer; sentences: TimedSentence[] };
type FallbackData = { lang?: string; sentences: string[] };

let activeRuntime: AudioRuntime | null = null;

export function attachSpokenTextRuntime(runtime: AudioRuntime): () => void {
  activeRuntime = runtime;
  return () => {
    if (activeRuntime === runtime) activeRuntime = null;
  };
}

export class SpokenText {
  private constructor(private readonly data: RenderedData | FallbackData) {}

  static async load(entry: SpokenTextEntry): Promise<SpokenText> {
    const [audio, alignment] = await Promise.all([fetch(entry.audioUrl), fetch(entry.alignmentUrl)]);
    if (!audio.ok) throw new Error(`SpokenText audio request failed (${audio.status})`);
    if (!alignment.ok) throw new Error(`SpokenText alignment request failed (${alignment.status})`);
    const document = (await alignment.json()) as unknown;
    return new SpokenText({
      bytes: await audio.arrayBuffer(),
      sentences: groupSentences(readAlignment(document)),
    });
  }

  static fromText(text: string, lang?: string): SpokenText {
    return new SpokenText({ ...(lang ? { lang } : {}), sentences: splitSentences(text) });
  }

  sentences(): string[] {
    return this.data.sentences.map((sentence) => (typeof sentence === 'string' ? sentence : sentence.text));
  }

  play(options: SpokenTextOptions = {}): SpokenTextHandle {
    if (typeof window !== 'undefined') trailerCapture(window)?.unsupported.push('spoken text');
    return 'bytes' in this.data ? this.playRendered(this.data, options) : this.playFallback(this.data, options);
  }

  private playRendered(data: RenderedData, options: SpokenTextOptions): SpokenTextHandle {
    const runtime = activeRuntime;
    if (!runtime || runtime.status() !== 'on') return { cancel() {} };
    let cancelled = false;
    let source: AudioBufferSourceNode | undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];

    void runtime.context
      .decodeAudioData(data.bytes.slice(0))
      .then((buffer) => {
        if (cancelled || runtime.status() !== 'on') return;
        source = runtime.context.createBufferSource();
        source.buffer = buffer;
        source.connect(runtime.voice);
        source.onended = () => {
          if (!cancelled) options.onEnd?.();
        };
        for (const [index, sentence] of data.sentences.entries()) {
          timers.push(
            setTimeout(() => {
              if (!cancelled) options.onSentence?.(index, sentence.text);
            }, sentence.start_ms),
          );
        }
        source.start();
      })
      .catch(() => {
        if (!cancelled) options.onEnd?.();
      });

    return {
      cancel() {
        if (cancelled) return;
        cancelled = true;
        for (const timer of timers) clearTimeout(timer);
        try {
          source?.stop();
        } catch {
          // A source that has already ended is already cancelled.
        }
      },
    };
  }

  private playFallback(data: FallbackData, options: SpokenTextOptions): SpokenTextHandle {
    let cancelled = false;
    let index = 0;
    const supported =
      typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';

    const next = () => {
      if (cancelled) return;
      const sentence = data.sentences[index];
      if (sentence === undefined) {
        options.onEnd?.();
        return;
      }
      options.onSentence?.(index, sentence);
      const utterance = new SpeechSynthesisUtterance(sentence);
      if (data.lang) utterance.lang = data.lang;
      utterance.onend = utterance.onerror = () => {
        index += 1;
        next();
      };
      speechSynthesis.speak(utterance);
    };

    if (supported) next();
    else queueMicrotask(() => !cancelled && options.onEnd?.());

    return {
      cancel() {
        cancelled = true;
        if (supported) speechSynthesis.cancel();
      },
    };
  }
}

function readAlignment(document: unknown): AlignmentSegment[] {
  const alignment =
    typeof document === 'object' && document !== null && 'alignment' in document
      ? (document as { alignment: unknown }).alignment
      : document;
  if (!Array.isArray(alignment)) throw new Error('SpokenText alignment is invalid');

  let previous = 0;
  return alignment.map((value) => {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof (value as AlignmentSegment).text !== 'string' ||
      !Number.isInteger((value as AlignmentSegment).start_ms) ||
      !Number.isInteger((value as AlignmentSegment).end_ms)
    ) {
      throw new Error('SpokenText alignment is invalid');
    }
    const segment = value as AlignmentSegment;
    if (segment.start_ms < previous || segment.end_ms < segment.start_ms) {
      throw new Error('SpokenText alignment is not monotonic');
    }
    previous = segment.start_ms;
    return segment;
  });
}
