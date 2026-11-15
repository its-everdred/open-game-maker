import { realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import type { TrailerCue } from './trailer-audio.js';

export type SoundEvent =
  | { type: 'sample'; timeMs: number; id: string; url: string; gain: number; rate: number }
  | { type: 'music'; timeMs: number; id: string; url: string; gain: number; fade: number }
  | { type: 'music-stop'; timeMs: number; fade: number }
  | { type: 'synth'; timeMs: number; samples: number[]; gain: number };
export type SoundLog = { events: SoundEvent[]; unsupported: string[] };

/** Resolve only files from the game build that the local capture server actually served. */
function assetPath(root: string, origin: string, rawUrl: string): string {
  const url = new URL(rawUrl, origin);
  if (url.origin !== new URL(origin).origin) throw new Error(`audio asset is not on the game origin: ${url.origin}`);
  const base = realpathSync(root);
  const path = realpathSync(resolve(base, `.${decodeURIComponent(url.pathname)}`));
  if (!path.startsWith(base + sep) || !statSync(path).isFile())
    throw new Error('audio asset is outside the game build');
  return path;
}

function writeSynth(path: string, samples: number[]): void {
  if (
    !Array.isArray(samples) ||
    samples.length === 0 ||
    samples.length > 44100 * 30 ||
    samples.some((sample) => !Number.isFinite(sample))
  )
    throw new Error('invalid synthesized sound');
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(44100, 24);
  bytes.writeUInt32LE(88200, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) =>
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2),
  );
  writeFileSync(path, bytes);
}

/** Convert recorded requests into mixer cues, ending music when the game changes or stops it. */
export function soundLogCues(
  log: SoundLog,
  root: string,
  origin: string,
  duration: number,
  scratch = root,
): TrailerCue[] {
  if (log.unsupported.length)
    throw new Error(`unsupported captured audio: ${[...new Set(log.unsupported)].join(', ')}`);
  const events = log.events;
  const cues: TrailerCue[] = [];
  let lastMs = -1;
  for (const [i, event] of events.entries()) {
    if (!Number.isFinite(event.timeMs) || event.timeMs < lastMs || event.timeMs < 0 || event.timeMs > duration * 1000)
      throw new Error('sound events are outside the clip or out of order');
    lastMs = event.timeMs;
    if (event.type === 'music-stop') continue;
    const time = event.timeMs / 1000;
    if (event.type === 'synth') {
      const file = join(scratch, `synth-${i}.wav`);
      writeSynth(file, event.samples);
      cues.push({ file, time, gain: event.gain });
      continue;
    }
    const base = { file: assetPath(root, origin, event.url), time, gain: event.gain };
    if (event.type === 'sample') cues.push({ ...base, rate: event.rate });
    else {
      const next = events.slice(i + 1).find((e) => e.type === 'music' || e.type === 'music-stop');
      const end = next ? Math.min(duration, next.timeMs / 1000 + next.fade * 2) : duration;
      if (end > time)
        cues.push({
          ...base,
          loop: true,
          length: end - time,
          fadeIn: event.fade,
          ...(next ? { fadeOut: next.fade * 2 } : {}),
        });
    }
  }
  return cues;
}
