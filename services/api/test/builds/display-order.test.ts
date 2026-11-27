import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { sweepBuilds } from '../../src/builds/publish.js';
import { builtFiles, CHECK_ID, completeRun, ids, SECRET, SHA, TICKET, world } from './fixtures.js';

// The second encoder pass (loading screens) waits on `gate`, standing in for the minutes it takes on a busy host.
const encoder = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
vi.mock('../../src/builds/display-images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/builds/display-images.js')>();
  return {
    ...actual,
    makeDisplayImages: async (...args: Parameters<typeof actual.makeDisplayImages>) => {
      if ((args[2]?.length ?? 0) > 0 && encoder.gate) await encoder.gate;
      return actual.makeDisplayImages(...args);
    },
  };
});

const archiveOf = (dir: string) => execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', dir, '.']);

async function publishWithLoadingScreens() {
  const { deps, app } = world();
  completeRun(deps);
  const dir = builtFiles();
  mkdirSync(join(dir, 'media'), { recursive: true });
  for (const name of ['thumbnail.png', 'logo.png', 'p.png', 'l.png'])
    await sharp({ create: { width: 400, height: 200, channels: 3, background: '#0a0' } })
      .png()
      .toFile(join(dir, 'media', name));
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      logo: 'media/logo.png',
      loading: { portrait: 'media/p.png', landscape: 'media/l.png' },
    }),
  );
  const response = await app.request(`http://127.0.0.1:4000/internal/jobs/by-ticket/${TICKET}/build`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SECRET}`,
      'x-gm-sha': SHA,
      'x-gm-check-id': CHECK_ID,
      'content-type': 'application/gzip',
    },
    body: archiveOf(dir),
  });
  expect(response.status).toBe(201);
  const { buildId } = (await response.json()) as { buildId: string };
  const sidecar = join(deps.config.gamesRoot, ids.game, buildId, '.ogm-display.json');
  const read = () => JSON.parse(readFileSync(sidecar, 'utf8')) as { partial?: true; images?: Record<string, unknown> };
  return { deps, buildId, read };
}

describe('display variants for a new build', () => {
  // #1312: a fresh build's card served 1.5 MB originals for as long as its loading screens took to encode.
  it('publishes the card art (thumbnail and logo) before the loading screens finish encoding', async () => {
    let release!: () => void;
    encoder.gate = new Promise((resolve) => (release = resolve));
    const { read } = await publishWithLoadingScreens();

    const early = await vi.waitFor(
      () => {
        const metadata = read();
        expect(metadata.partial).toBe(true);
        return metadata;
      },
      { timeout: 30_000 },
    );
    expect(Object.keys(early.images ?? {}).sort()).toEqual(['media/logo.png', 'media/thumbnail.png']);

    release();
    const done = await vi.waitFor(
      () => {
        const metadata = read();
        expect(metadata.partial).toBeUndefined();
        return metadata;
      },
      { timeout: 30_000 },
    );
    expect(Object.keys(done.images ?? {}).sort()).toEqual([
      'media/l.png',
      'media/logo.png',
      'media/p.png',
      'media/thumbnail.png',
    ]);
  });

  it('finishes a build whose loading screens failed after its card art was published', async () => {
    encoder.gate = Promise.reject(new Error('encoder crashed'));
    encoder.gate.catch(() => undefined);
    const { deps, buildId, read } = await publishWithLoadingScreens();
    const marker = join(deps.config.gamesRoot, '.display-pending', buildId);
    await vi.waitFor(
      () => expect(deps.lines).toContainEqual(expect.objectContaining({ event: 'build_display_images_failed' })),
      {
        timeout: 30_000,
      },
    );
    expect(read().partial).toBe(true);
    expect(existsSync(marker)).toBe(true);

    encoder.gate = null;
    await sweepBuilds(deps, 60_000);
    const done = await vi.waitFor(
      () => {
        const metadata = read();
        expect(metadata.partial).toBeUndefined();
        return metadata;
      },
      { timeout: 30_000 },
    );
    expect(Object.keys(done.images ?? {})).toContain('media/p.png');
    await vi.waitFor(() => expect(existsSync(marker)).toBe(false));
  });
});
