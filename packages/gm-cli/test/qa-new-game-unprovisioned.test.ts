import { describe, expect, it, vi } from 'vitest';
import { verifyUnprovisionedQaGame } from '../src/qa-new-game-unprovisioned.js';

describe('unprovisioned QA cleanup', () => {
  it('requires a terminal create audit and an empty folder and creation branch', async () => {
    const git = {
      readMain: vi.fn(async () => ({ sha: 'a', tree: [], truncated: false })),
      hasOpenCreationPull: vi.fn(async () => false),
      openRemovalPull: vi.fn(),
      mergePull: vi.fn(),
      folderExists: vi.fn(),
    };
    const request = vi.fn(async () => []);
    const terminal = vi.fn(async (id: string) => id === 'g_123');
    await verifyUnprovisionedQaGame('example/games', 'games/qa', 'g_123', git, request, terminal);
    await expect(
      verifyUnprovisionedQaGame('example/games', 'games/qa', 'g_other', git, request, terminal),
    ).rejects.toThrow(/audit/);
    git.readMain.mockResolvedValueOnce({
      sha: 'a',
      tree: [{ path: 'games/qa/file', mode: '100644', type: 'blob' }] as never[],
      truncated: false,
    });
    await expect(
      verifyUnprovisionedQaGame('example/games', 'games/qa', 'g_123', git, request, terminal),
    ).rejects.toThrow(/folder exists/);
  });
});
