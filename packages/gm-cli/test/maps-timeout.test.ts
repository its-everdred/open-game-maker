import { chmodSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { gm, tempDir } from './helpers.js';
import { mapsLibrary } from './library-rights.js';

const python = vi.hoisted(() => ({ path: '' }));
vi.mock('../src/packs/workers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/packs/workers.js')>()),
  resolvePython: async () => python.path,
}));

describe('map search from a game workspace', () => {
  it('returns indexed results when the optional CLIP worker hangs', async () => {
    const library = mapsLibrary();
    expect((await gm(['maps', 'index'], { env: { OGM_ASSETS_ROOT: library } })).code).toBe(0);
    writeFileSync(join(library, 'catalog.json'), '{}');
    const game = tempDir('game-workspace-');
    symlinkSync(library, join(game, 'assets-local'), 'dir');
    python.path = join(game, 'python');
    writeFileSync(python.path, '#!/bin/sh\nexec sleep 30\n');
    chmodSync(python.path, 0o755);
    const start = Date.now();
    const result = await gm(['maps', 'search', '--maps', 'camp'], { cwd: game });
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(result.code).toBe(0);
    expect(result.out.length).toBeGreaterThan(0);
    expect(result.err.join('\n')).toContain('ranking by indexed text only');
  }, 60_000);
});
