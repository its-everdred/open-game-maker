import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readQaManifest, saveQaManifest, unknownQaGames } from '../src/qa-new-game-manifest.js';

describe('New Game recovery manifest', () => {
  it('persists only identified games and refuses an unexplained new row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-manifest-'));
    try {
      const path = join(dir, 'state.json');
      const state = {
        version: 1 as const,
        repo: 'example/games',
        run: 'abc-123',
        baseline: ['g_old'],
        games: [{ id: 'g_created', status: 502, ok: false, cleaned: false, deleteReady: false }],
        complete: false,
      };
      await saveQaManifest(path, state);
      expect(await readQaManifest(path, 'example/games')).toEqual(state);
      expect(unknownQaGames(state, ['g_old', 'g_created', 'g_unknown'])).toEqual(['g_unknown']);
      await expect(readQaManifest(path, 'another/games')).rejects.toThrow(/repository/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
