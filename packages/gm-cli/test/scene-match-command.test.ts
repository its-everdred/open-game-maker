import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import type { GmContext } from '../src/command.js';

vi.mock('../src/packs/workers.js', () => ({ resolvePython: async () => '/local/python' }));
vi.mock('../src/scene/run-match.js', () => ({
  runSceneMatch: vi.fn(async () => ({
    scope: { pack: 'test-pack', kind: 'sprite', facing: 'E' },
    examined: 1,
    eligible: 2,
    truncated: true,
    regions: [],
  })),
}));
import { command } from '../src/commands/scene/match.js';
import { runSceneMatch } from '../src/scene/run-match.js';

it('sends reviewed crops to the local worker and saves its incomplete result without overwriting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scene-match-command-'));
  try {
    await writeFile(
      join(dir, 'brief.json'),
      JSON.stringify({
        image: { width: 10, height: 10 },
        story: 'A grave.',
        mood: 'Dusk',
        light: 'Warm',
        focalRegion: 'grave',
        regions: [{ id: 'grave', label: 'Grave', layer: 'prop', bounds: { x: 1, y: 2, width: 3, height: 4 } }],
      }),
    );
    await sharp({ create: { width: 10, height: 10, channels: 4, background: '#000' } }).toFile(join(dir, 'mock.png'));
    const output: string[] = [];
    const ctx = { cwd: dir, assetsRoot: dir, out: (line: string) => output.push(line) } as GmContext;
    const flags = { pack: 'test-pack', facing: 'E', out: 'matches.json' };
    expect(await command.run(ctx, ['mock.png', 'brief.json'], flags)).toBe(0);
    expect(runSceneMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        python: '/local/python',
        assetsRoot: dir,
        pack: 'test-pack',
        mock: join(dir, 'mock.png'),
        crops: [[1, 2, 3, 4]],
        facing: 'E',
        encoder: 'clip',
      }),
    );
    expect(JSON.parse(await readFile(join(dir, 'matches.json'), 'utf8'))).toMatchObject({
      examined: 1,
      eligible: 2,
      truncated: true,
    });
    expect(JSON.parse(output[0]!)).toMatchObject({ truncated: true });
    await expect(command.run(ctx, ['mock.png', 'brief.json'], flags)).rejects.toThrow(
      'already exists; pass a new output path',
    );
    await sharp({ create: { width: 20, height: 10, channels: 4, background: '#000' } }).toFile(join(dir, 'wide.png'));
    await expect(command.run(ctx, ['wide.png', 'brief.json'], { ...flags, out: 'wide.json' })).rejects.toThrow(
      'brief image is 10x10 but the mock is 20x10',
    );
    await expect(command.run(ctx, ['mock.png', 'brief.json'], { ...flags, facing: 'up' })).rejects.toThrow(
      'provide mock',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
