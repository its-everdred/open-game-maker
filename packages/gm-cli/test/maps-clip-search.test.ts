import { describe, expect, it, vi } from 'vitest';

import { gm } from './helpers.js';
import { mapsLibrary } from './library-rights.js';

vi.mock('../src/maps/clip.js', () => ({
  clipScores: async () => new Map([['t1:profantasy-cartographers-annual/example-dungeon-01@illustrative', 0.8]]),
}));

describe('semantic map search', () => {
  it('uses the CLIP score to rank a matching map ahead of unscored maps', async () => {
    const root = mapsLibrary();
    const env = { OGM_ASSETS_ROOT: root };
    expect((await gm(['maps', 'index'], { env })).code).toBe(0);
    const result = await gm(['maps', 'search', '--maps', 'unmatched', '--limit', '100'], { env });
    expect(result.code).toBe(0);
    expect(result.out[0]).toMatch(/^t1:profantasy-cartographers-annual\/example-dungeon-01@illustrative  /);
  }, 60_000);
});
