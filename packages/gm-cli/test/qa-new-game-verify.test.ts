import { describe, expect, it, vi } from 'vitest';
import { QA_TURNS } from '../src/qa-new-game-steps.js';
import { verifyNewGame } from '../src/qa-new-game-verify.js';

describe('New Game verification', () => {
  it('checks the live library progress and verifies the filed parent and private context', async () => {
    const progress = { waitFor: vi.fn(), innerText: vi.fn(async () => 'Building') };
    const cell = { waitFor: vi.fn(), locator: vi.fn(() => progress) };
    const page = { locator: vi.fn(() => cell) } as never;
    const api = {
      report: vi.fn(async () => ({
        game: { id: 'g_123', slug: 'qa', path: 'games/qa', repoUrl: null },
        daemon: null,
        tickets: [],
        sessions: [],
        jobs: [{ id: 'j_123', kind: 'new_game', state: 'filed', releasedAt: null, repo: 'example/games', issue: 7 }],
      })),
      context: vi.fn(async () => ({
        request: 'j_123',
        game: { id: 'g_123' },
        parent: { repo: 'example/games', number: 7 },
        messages: QA_TURNS.map((text) => ({ actor: 'creator', text })),
      })),
    };
    const parents = vi.fn(async () => [
      {
        number: 7,
        repo: 'example/games',
        title: 'QA',
        labels: ['request:new-game'],
        body: '## Creation choices\nBrief: QA game\n- Game: g_123\n- Private context reference: j_123',
      },
    ]);
    await expect(verifyNewGame(page, 'g_123', 'j_123', 'example/games', api, parents)).resolves.toBeUndefined();
    expect(progress.waitFor).toHaveBeenCalled();
    parents.mockResolvedValueOnce([{ ...(await parents())[0]!, body: QA_TURNS[0] }]);
    await expect(verifyNewGame(page, 'g_123', 'j_123', 'example/games', api, parents)).rejects.toThrow();
  });
});
