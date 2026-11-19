import { describe, expect, it, vi } from 'vitest';

import { closeQaCreationPull } from '../src/qa-new-game-creation-pull.js';

describe('QA creation pull cleanup', () => {
  it('closes only a matching pull whose complete diff adds files in the QA folder', async () => {
    const pull = {
      number: 7,
      title: 'Add game qa',
      state: 'open',
      changed_files: 1,
      head: { ref: 'game/qa', sha: 'a'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    let reads = 0;
    let closed = false;
    const request = vi.fn(async (method: string, path: string): Promise<unknown> => {
      if (path.includes('/pulls?')) return closed ? [] : [pull];
      if (path.endsWith('/pulls/7') && method === 'GET' && reads++ === 0) return pull;
      if (path.includes('/files?')) return [{ filename: 'games/qa/a', status: 'added' }];
      if (path.includes('/git/ref/heads/')) return { object: { sha: 'a'.repeat(40) } };
      if (path.includes('/git/matching-refs/')) return [];
      if (method === 'PATCH') {
        closed = true;
        return { ...pull, state: 'closed' };
      }
      if (method === 'DELETE') return {};
      if (path.endsWith('/pulls/7')) return { ...pull, state: 'closed' };
      throw new Error('unexpected request');
    });
    await closeQaCreationPull('example/games', 'games/qa', request);
    expect(request).toHaveBeenCalledWith('PATCH', '/repos/example/games/pulls/7', { state: 'closed' });
    expect(request).toHaveBeenCalledWith('DELETE', '/repos/example/games/git/refs/heads/game/qa');
    const bad = vi.fn(async (_method: string, path: string): Promise<unknown> =>
      path.includes('/pulls?')
        ? [pull]
        : path.endsWith('/pulls/7')
          ? pull
          : [{ filename: 'games/other/a', status: 'added' }],
    );
    await expect(closeQaCreationPull('example/games', 'games/qa', bad)).rejects.toThrow(/diff/);
    expect(bad).toHaveBeenCalledTimes(3);
  });

  it('cleans an unchanged branch left by a verified merged creation pull', async () => {
    const merged = {
      number: 8,
      title: 'Add game qa',
      state: 'closed',
      merged_at: '2026-01-01T00:00:00Z',
      changed_files: 1,
      head: { ref: 'game/qa', sha: 'a'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    let refReads = 0;
    const request = vi.fn(async (method: string, path: string): Promise<unknown> => {
      if (path.includes('/pulls?') && path.includes('state=open')) return [];
      if (path.includes('/pulls?') && path.includes('state=closed')) return [merged];
      if (path.includes('/matching-refs/'))
        return refReads++ === 0 ? [{ ref: 'refs/heads/game/qa', object: { sha: 'a'.repeat(40) } }] : [];
      if (path.includes('/files?')) return [{ filename: 'games/qa/a', status: 'added' }];
      if (path.includes('/git/ref/heads/')) return { object: { sha: 'a'.repeat(40) } };
      if (path.endsWith('/pulls/8')) return merged;
      if (method === 'DELETE') return {};
      throw new Error('unexpected request');
    });
    await closeQaCreationPull('example/games', 'games/qa', request);
    expect(request).not.toHaveBeenCalledWith('PATCH', expect.any(String), expect.anything());
    expect(request).toHaveBeenCalledWith('DELETE', '/repos/example/games/git/refs/heads/game/qa');
  });

  it('checks later diff pages before closing a large creation pull', async () => {
    const pull = {
      number: 7,
      title: 'Add game qa',
      state: 'open',
      changed_files: 101,
      head: { ref: 'game/qa', sha: 'a'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    const request = vi.fn(async (_method: string, path: string): Promise<unknown> => {
      if (path.includes('/pulls?')) return [pull];
      if (path.endsWith('/pulls/7')) return pull;
      if (path.includes('page=1'))
        return Array.from({ length: 100 }, (_, i) => ({ filename: `games/qa/${i}`, status: 'added' }));
      if (path.includes('page=2')) return [{ filename: 'games/other/file', status: 'added' }];
      throw new Error('unexpected request');
    });
    await expect(closeQaCreationPull('example/games', 'games/qa', request)).rejects.toThrow(/diff/);
    expect(request.mock.calls.some(([method]) => method !== 'GET')).toBe(false);
  });
});
