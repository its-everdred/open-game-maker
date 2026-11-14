import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { BlobHash, BlobStore } from '@ogm/blob-store';

const run = promisify(execFile);
const LIMIT = 64 * 1024 * 1024;

// Validate the stored capture itself; a worker's `hasAudio` flag is not proof of an audio stream.
export async function isCaptureWithAudio(store: BlobStore, ref: string): Promise<boolean> {
  if (!/^sha256:[0-9a-f]{64}$/u.test(ref)) return false;
  const blob = await store.open(ref as BlobHash);
  if (!blob || blob.ref.mime !== 'video/mp4' || blob.ref.bytes > LIMIT) return false;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of blob.stream) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > LIMIT) return false;
    chunks.push(bytes);
  }
  const directory = await mkdtemp(join(tmpdir(), 'ogm-review-clip-'));
  try {
    const file = join(directory, 'clip.mp4');
    await writeFile(file, Buffer.concat(chunks), { mode: 0o600 });
    const result = await run(
      '/usr/bin/ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type:format=format_name', '-of', 'json', file],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    const info = JSON.parse(result.stdout) as {
      streams?: { codec_type?: string }[];
      format?: { format_name?: string };
    };
    return (
      (info.format?.format_name ?? '').split(',').includes('mp4') &&
      !!info.streams?.some((stream) => stream.codec_type === 'video') &&
      !!info.streams?.some((stream) => stream.codec_type === 'audio')
    );
  } catch {
    return false;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
