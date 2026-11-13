import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ORC, preparedLibrary, useOrc } from './assets-fixture.js';
import { gm, tempDir } from './helpers.js';
import { readLock } from '../src/lock.js';
import { resolveEntry } from '../src/resolve.js';

const state = vi.hoisted(() => ({ request: undefined as Record<string, unknown> | undefined, dir: '' }));
vi.mock('@ogm/gm-verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ogm/gm-verify')>();
  return {
    ...actual,
    newRunId: () => 'scenery-test',
    submitRequest: (cwd: string, request: Record<string, unknown>) => {
      state.request = request;
      state.dir = join(cwd, '.gm/verify/scenery-test');
      mkdirSync(join(state.dir, 'desktop'), { recursive: true });
      return state.dir;
    },
    waitForReport: async () => {
      writeFileSync(join(state.dir, 'desktop/t0.png'), 'image');
      return { verdict: 'pass', frames: [{ path: 'desktop/t0.png' }] };
    },
  };
});

it('queues a standalone preview and copies the host still', async () => {
  const cwd = tempDir();
  const assetsRoot = preparedLibrary();
  await useOrc(cwd, assetsRoot);
  const pack = join(assetsRoot, 'packs/kenney-mini-dungeon');
  const cardPath = join(pack, 'collection.card.json');
  const card = JSON.parse(readFileSync(cardPath, 'utf8'));
  card.collection_info.pack_manifest = 'assets-local/packs/custom-location/pack.json';
  writeFileSync(cardPath, JSON.stringify(card));
  mkdirSync(join(assetsRoot, 'packs/custom-location'), { recursive: true });
  renameSync(join(pack, '2.0'), join(assetsRoot, 'packs/custom-location/2.0'));
  const entry = (await readLock(cwd))!.assets.find((asset) => asset.id === ORC)!;
  expect((await resolveEntry(entry, { cwd, assetsRoot, blobRoot: null })).ok).toBe(false);
  await gm(['scenery', 'add', 'oak', ORC, '--position', '1,0,2'], { cwd });
  const result = await gm(['scenery', 'render', '--out', 'shot.png'], {
    cwd,
    env: { OGM_ASSETS_ROOT: assetsRoot, GM_VERIFY_QUEUE: '1' },
  });
  expect(result.code).toBe(0);
  expect(state.request).toMatchObject({ args: { viewport: 'desktop', frame: 'bare', frames: [0] } });
  expect(readFileSync(join(cwd, 'shot.png'), 'utf8')).toBe('image');
}, 60_000);
