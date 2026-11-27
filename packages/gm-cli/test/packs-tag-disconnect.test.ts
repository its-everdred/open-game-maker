import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: ((command: string, args: string[], options: object) => {
      if (args?.[0]?.endsWith('/model-preview-worker.js')) {
        return actual.spawn(command, ['-e', "process.kill(process.pid, 'SIGKILL')"], options);
      }
      return actual.spawn(command, args, options);
    }) as typeof actual.spawn,
  };
});

import { gm, library } from './helpers.js';

it('records a real preview worker disconnect and exits nonzero', async () => {
  const assetsRoot = library();
  const root = join(assetsRoot, 'packs/kenney-mini-dungeon');
  const cards = join(root, 'cards');
  const path = join(cards, 'wall.card.json');
  const card = JSON.parse(await readFile(path, 'utf8')) as {
    status: string;
    source: { files: Array<{ path: string; sha256: string }> };
  };
  card.status = 'measured';
  card.source.files[0]!.sha256 = `sha256:${createHash('sha256').update('glb').digest('hex')}`;
  await rm(cards, { recursive: true });
  await mkdir(cards, { recursive: true });
  await writeFile(path, JSON.stringify(card));
  await writeFile(join(root, 'pack.json'), JSON.stringify({ current: 'v1' }));
  const source = join(root, 'v1/extracted', card.source.files[0]!.path);
  await mkdir(dirname(source), { recursive: true });
  await writeFile(source, 'glb');
  const result = await gm(['packs', 'tag', '--kind', 'model', '--only', 'kenney-mini-dungeon', '--json'], {
    env: { OGM_ASSETS_ROOT: assetsRoot },
  });
  expect(result.code, result.err.join('\n')).toBe(1);
  const output = result.out.map((line) => JSON.parse(line));
  expect(output.at(-1).summary).toMatchObject({ cards: 0, skipped: 1 });
  expect(output.some((record) => String(record.skipped).includes('preview worker exited'))).toBe(true);
  const updated = JSON.parse(await readFile(path, 'utf8'));
  expect(updated.provenance.preview_failure.input).toContain('skipped: preview worker exited');
}, 90_000);
