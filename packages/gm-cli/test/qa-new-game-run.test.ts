import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readQaManifest, saveQaManifest } from '../src/qa-new-game-manifest.js';
import { runNewGameQa } from '../src/qa-new-game-run.js';

describe('New Game QA recovery', () => {
  it('runs both captures even when an old QA row needs reconciliation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'new-game-qa-'));
    try {
      const capture = vi.fn(async () => [
        { viewport: '390x844', ok: true, failures: [], stills: [], mp4: null },
        { viewport: '844x390', ok: true, failures: [], stills: [], mp4: null },
      ]);
      const result = await runNewGameQa(
        { out: dir, repo: 'example/games', run: 'run-1', legacyIds: ['g_old'] },
        {
          inventory: async () => ['g_old'],
          cleanup: async () => {
            throw new Error('needs reconciliation');
          },
          capture,
        },
      );
      expect(capture).toHaveBeenCalledOnce();
      expect(result.failures.join(' ')).toContain('needs reconciliation');
      expect(result.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resumes when row deletion succeeded after the external cleanup checkpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'new-game-qa-'));
    try {
      let games: string[] = [];
      const first = await runNewGameQa(
        { out: dir, repo: 'example/games', run: 'run-1' },
        {
          inventory: async () => games,
          capture: async (created) => {
            games = ['g_new'];
            await created({ id: 'g_new', ok: true, status: 201 });
            return [];
          },
          cleanup: async (_id, _run, ready) => {
            await ready();
            games = [];
            throw new Error('lost response');
          },
        },
      );
      expect(first.ok).toBe(false);
      const second = await runNewGameQa(
        { out: dir, repo: 'example/games', run: 'run-2' },
        {
          inventory: async () => games,
          capture: async () => [],
          cleanup: async () => {
            throw new Error('already removed');
          },
        },
      );
      expect(second.failures.join(' ')).not.toContain('disappeared');
      expect((await readQaManifest(join(dir, 'state.json'), 'example/games'))?.run).toBe('run-2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records a created game before capture continues and preserves it if cleanup fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'new-game-qa-'));
    try {
      let games = ['g_existing'];
      const cleanup = vi.fn(async () => {
        throw new Error('remote cleanup failed');
      });
      const capture = vi.fn(async (created: (game: { id: string; ok: boolean; status: number }) => Promise<void>) => {
        games = [...games, 'g_new'];
        await created({ id: 'g_new', ok: false, status: 502 });
        expect((await readQaManifest(join(dir, 'state.json'), 'example/games'))?.games[0]?.id).toBe('g_new');
        return [{ viewport: '390x844', ok: false, failures: ['502'], stills: [], mp4: null }];
      });
      const result = await runNewGameQa(
        { out: dir, repo: 'example/games', run: 'run-1' },
        {
          inventory: async () => games,
          cleanup,
          capture,
        },
      );
      expect(result.ok).toBe(false);
      expect(cleanup).toHaveBeenCalledWith('g_new', 'run-1', expect.any(Function));
      expect((await readQaManifest(join(dir, 'state.json'), 'example/games'))?.games[0]?.cleaned).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reconciles explicitly identified legacy games from an interrupted run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'new-game-qa-'));
    try {
      await saveQaManifest(join(dir, 'state.json'), {
        version: 1,
        repo: 'example/games',
        run: 'run-1',
        baseline: [],
        games: [],
        complete: false,
      });
      let games = ['g_old'];
      const cleanup = vi.fn(async () => {
        games = [];
      });
      const result = await runNewGameQa(
        { out: dir, repo: 'example/games', run: 'run-2', legacyIds: ['g_old'] },
        {
          inventory: async () => games,
          cleanup,
          capture: async () => [],
        },
      );
      expect(cleanup).toHaveBeenCalledWith('g_old', 'legacy-g_old', expect.any(Function));
      expect(result.failures).not.toContain(expect.stringContaining('unidentified'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not guess ownership when a create response is lost', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'new-game-qa-'));
    try {
      let games = ['g_existing'];
      const cleanup = vi.fn();
      const result = await runNewGameQa(
        { out: dir, repo: 'example/games', run: 'run-2' },
        {
          inventory: async () => games,
          cleanup,
          capture: async () => {
            games = [...games, 'g_unknown'];
            throw new Error('connection lost');
          },
        },
      );
      expect(result.ok).toBe(false);
      expect(result.failures.join(' ')).toContain('g_unknown');
      expect(cleanup).not.toHaveBeenCalled();
      expect((await readQaManifest(join(dir, 'state.json'), 'example/games'))?.complete).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
