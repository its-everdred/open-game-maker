import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { outputName } from './files.js';
import { manifestAsset, type BuildJob, type FreshJobResult } from './types.js';

const execFileAsync = promisify(execFile);

/** Encode `source` to an MP3 at `target`; rejects with the process error (its `stderr` included) on failure. */
export type Mp3Encoder = (source: string, target: string) => Promise<unknown>;

const ffmpeg: Mp3Encoder = (source, target) =>
  execFileAsync(
    'ffmpeg',
    ['-nostdin', '-y', '-i', source, '-af', 'loudnorm=I=-16:TP=-1.5', '-codec:a', 'libmp3lame', '-q:a', '4', target],
    { maxBuffer: 4 * 1024 * 1024, timeout: 120_000, killSignal: 'SIGKILL' },
  );

/**
 * One attempt: ffmpeg under load sometimes exits with "Conversion failed" or leaves a 0-byte file, so an empty output is
 * a failure too, and never reaches the manifest or the shared cache.
 */
async function attempt(source: string, target: string, encode: Mp3Encoder): Promise<Buffer> {
  await rm(target, { force: true });
  try {
    await encode(source, target);
  } catch (error) {
    throw new Error((error as { stderr?: string }).stderr?.trim() || String(error), { cause: error });
  }
  const bytes = await readFile(target).catch(() => Buffer.alloc(0));
  if (bytes.length === 0) throw new Error('ffmpeg wrote an empty file');
  return bytes;
}

/** A failed conversion is retried once; the first attempt's stderr goes to the build log either way. */
export async function buildAudio(
  job: BuildJob,
  log: (line: string) => void = () => {},
  encode: Mp3Encoder = ffmpeg,
): Promise<FreshJobResult> {
  const item = job.items[0]!;
  const scratch = await mkdtemp(join(tmpdir(), 'gm-build-audio-'));
  const target = join(scratch, 'output.mp3');
  try {
    let bytes: Buffer;
    try {
      bytes = await attempt(item.source, target, encode);
    } catch (first) {
      log(`${item.entry.id}: ffmpeg failed, retrying once. stderr:\n${(first as Error).message}`);
      try {
        bytes = await attempt(item.source, target, encode);
      } catch (second) {
        const detail = (second as Error).message;
        log(`${item.entry.id}: ffmpeg retry failed. stderr:\n${detail}`);
        throw new Error(`${item.entry.id}: ffmpeg failed: ${detail.split('\n').slice(-2).join(' ')}`, {
          cause: second,
        });
      }
    }
    const name = outputName(bytes, 'mp3');
    return {
      files: { [name]: { bytes: bytes.length, decoders: [] } },
      assets: { [item.entry.id]: manifestAsset(item, { '*': name }) },
      buffers: { [name]: bytes },
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
