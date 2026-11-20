import { describe, expect, it, vi } from 'vitest';
import { QA_TURNS } from '../src/qa-new-game-steps.js';
import { verifyNewGame } from '../src/qa-new-game-verify.js';

describe('New Game verification', () => {
  it('checks the live library progress and verifies the filed parent and private context', async () => {
    const progress = { waitFor: vi.fn(), innerText: vi.fn(async () => 'Building') };
    const cell = { waitFor: vi.fn(), locator: vi.fn(() => progress) };
    const waitForFunction = vi.fn(async (...args: [predicate: () => boolean, argument: unknown, options: unknown]) => {
      const [predicate] = args;
      if (!predicate()) throw new Error('decision queue did not contain five media-backed requests');
    });
    const page = {
      locator: vi.fn(() => cell),
      waitForFunction,
    } as never;
    const inventory = vi.fn(async () => undefined);
    const media = {};
    const request = (withOptions: boolean, withMedia: boolean) => ({
      querySelectorAll: vi.fn(() =>
        withOptions
          ? [
              { querySelector: vi.fn(() => (withMedia ? media : null)) },
              { querySelector: vi.fn(() => (withMedia ? media : null)) },
            ]
          : [],
      ),
      querySelector: vi.fn(() => (withMedia ? media : null)),
    });
    const installQueue = (items: ReturnType<typeof request>[]) => {
      vi.stubGlobal('document', { querySelectorAll: vi.fn(() => items) });
    };
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
    installQueue(Array.from({ length: 5 }, () => request(true, true)));
    await expect(
      verifyNewGame(page, 'g_123', 'j_123', 'example/games', api, parents, inventory, Date.now()),
    ).resolves.toBeUndefined();
    installQueue(Array.from({ length: 5 }, () => request(false, true)));
    await expect(
      verifyNewGame(page, 'g_123', 'j_123', 'Example/Games', api, parents, inventory, Date.now()),
    ).resolves.toBeUndefined();
    expect(progress.waitFor).toHaveBeenCalled();
    expect(inventory).toHaveBeenCalledWith('example/games', 'qa');
    expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function), undefined, {
      timeout: expect.any(Number),
    });
    const timeout = (waitForFunction.mock.calls[0]?.[2] as { timeout?: number } | undefined)?.timeout;
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(600_000);
    installQueue([request(true, false), ...Array.from({ length: 4 }, () => request(true, true))]);
    await expect(
      verifyNewGame(page, 'g_123', 'j_123', 'example/games', api, parents, inventory, Date.now()),
    ).rejects.toThrow('decision queue did not contain five media-backed requests');
    vi.unstubAllGlobals();
    parents.mockResolvedValueOnce([{ ...(await parents())[0]!, body: QA_TURNS[0] }]);
    await expect(
      verifyNewGame(page, 'g_123', 'j_123', 'example/games', api, parents, inventory, Date.now()),
    ).rejects.toThrow();
  });
});
