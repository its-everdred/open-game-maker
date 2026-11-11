import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { Image } from './score.js';

const exec = promisify(execFile);

/** Optional local adapter: gm-look-lpips receives two PNG paths and prints an LPIPS distance. */
export async function perceptual(
  a: Image,
  b: Image,
  adapter?: string,
): Promise<{ score: number | null; note: string }> {
  if (!adapter) return { score: null, note: 'No local LPIPS adapter configured; perceptual score skipped' };
  const dir = await mkdtemp(join(tmpdir(), 'gm-look-'));
  try {
    const paths = [join(dir, 'target.png'), join(dir, 'candidate.png')];
    await Promise.all(
      [a, b].map((im, i) =>
        sharp(im.pixels, { raw: { width: im.width, height: im.height, channels: 3 } })
          .png()
          .toFile(paths[i]!),
      ),
    );
    const result = await exec(adapter, paths, { timeout: 60_000 });
    const value = Number(result.stdout.trim());
    if (!result.stdout.trim() || !Number.isFinite(value) || value < 0) throw new Error('invalid LPIPS result');
    return { score: value, note: 'LPIPS distance; lower is closer' };
  } catch {
    return { score: null, note: 'Local gm-look-lpips adapter unavailable or failed; perceptual score skipped' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
