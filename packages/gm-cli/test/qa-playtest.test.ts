import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readPlaytestPlan } from '../src/playtest-plan.js';
import { gm, tempDir } from './helpers.js';

const roots: string[] = [];
function game(manifest: Record<string, unknown>): string {
  const root = tempDir();
  roots.push(root);
  writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify(manifest));
  return root;
}

const MODES = [
  { id: 'blobs', label: 'Blobs', tap: 'Play>Endless>Blobs>Play' },
  { id: 'blocks', label: 'Blocks', tap: 'Play>Endless>Blocks>Play' },
  { id: 'both', label: 'Both', tap: 'Play > Endless > Both > Play' },
];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('gm qa playtest plan', () => {
  /* Kevin's Both-mode defects shipped because only the ticket's mode was ever captured. */
  it('plays every listed mode with --all-modes, each along its own tap path', () => {
    const plan = readPlaytestPlan(game({ modes: MODES, controlBindings: { Space: 'hardDrop' } }), { all: true });
    expect(plan.modes).toEqual([
      { id: 'blobs', taps: ['Play', 'Endless', 'Blobs', 'Play'] },
      { id: 'blocks', taps: ['Play', 'Endless', 'Blocks', 'Play'] },
      { id: 'both', taps: ['Play', 'Endless', 'Both', 'Play'] },
    ]);
    expect(plan.keys).toEqual([{ key: 'Space', action: 'hardDrop', drop: true }]);
    expect(plan.notes).toEqual([]);
  });

  it('plays the first mode by default and one named mode with --mode', () => {
    const root = game({ modes: MODES });
    expect(readPlaytestPlan(root, { all: false }).modes.map((mode) => mode.id)).toEqual(['blobs']);
    expect(readPlaytestPlan(root, { all: false, mode: 'both' }).modes.map((mode) => mode.id)).toEqual(['both']);
    expect(() => readPlaytestPlan(root, { all: false, mode: 'duo' })).toThrow(
      'no mode duo; modes: blobs, blocks, both',
    );
  });

  it('falls back to the play-area path and says so for a game that lists no modes', () => {
    const plan = readPlaytestPlan(game({ playArea: { tap: 'Play>Endless' } }), { all: true });
    expect(plan.modes).toEqual([{ id: 'play', taps: ['Play', 'Endless'] }]);
    expect(plan.notes.join('\n')).toContain('lists no modes');
    expect(plan.notes.join('\n')).toContain('no controlBindings');
  });

  it('rejects a malformed modes list', () => {
    expect(() => readPlaytestPlan(game({ modes: [{ id: 'a', label: 'A', tap: 'Play>>Go' }] }), { all: true })).toThrow(
      'gm.manifest.json',
    );
  });
});

describe('gm qa playtest command', () => {
  it('refuses a game that is not built', async () => {
    const root = game({ modes: MODES });
    mkdirSync(join(root, 'dist'));
    const result = await gm(['qa', 'playtest', root, '--all-modes']);
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('game build is missing index.html');
  });

  it('refuses --all-modes with --mode', async () => {
    const result = await gm(['qa', 'playtest', game({ modes: MODES }), '--all-modes', '--mode', 'both']);
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('conflict');
  });
});
