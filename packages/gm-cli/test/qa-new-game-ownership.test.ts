import { describe, expect, it, vi } from 'vitest';
import { renderRepoTemplate } from '@ogm/game-repo-template';
import { assertQaFolderOwnership } from '../src/qa-new-game-ownership.js';

describe('QA folder ownership', () => {
  it('requires the creation commit to contain the exact game ID in the real 2D scaffold', async () => {
    const content = renderRepoTemplate('game-2d@1', {
      gameId: 'g_123',
      owner: 'example',
      visibility: 'private',
    }).files.find((file) => file.path === 'AGENTS.md')!.content;
    const request = vi.fn(async (_method: string, path: string): Promise<unknown> => {
      if (path.includes('/commits?')) return [{ sha: 'a'.repeat(40), commit: { message: 'Game-Folder: games/qa' } }];
      if (path.endsWith(`/contents/games/qa/AGENTS.md?ref=${'a'.repeat(40)}`))
        return { encoding: 'base64', content: Buffer.from(content).toString('base64') };
      throw new Error('unexpected request');
    });
    await assertQaFolderOwnership('example/games', 'games/qa', 'g_123', request);
    await expect(assertQaFolderOwnership('example/games', 'games/qa', 'g_other', request)).rejects.toThrow(/ownership/);
  });
});
