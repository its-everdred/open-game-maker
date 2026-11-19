import { describe, expect, it, vi } from 'vitest';

import { createQaFolderGit } from '../src/qa-new-game-folder-github.js';
import { QaGitHubError } from '../src/qa-new-game-gh-request.js';

describe('QA folder GitHub adapter', () => {
  it('limits root scope removals to the verified session', async () => {
    const request = vi.fn(async (_method: string, path: string): Promise<unknown> => {
      if (path.includes('/git/commits/')) return { tree: { sha: 'b'.repeat(40) } };
      if (path.endsWith('/git/trees')) return { sha: 'c'.repeat(40) };
      if (path.endsWith('/git/commits')) return { sha: 'd'.repeat(40) };
      if (path.endsWith('/git/refs')) return {};
      if (path.endsWith('/pulls')) return { number: 7 };
      throw new Error('unexpected request');
    });
    const git = createQaFolderGit('example/games', 'games/qa', 'run-1', request, {}, ['.gm/scope/s_123.json']);
    await expect(
      git.openRemovalPull('a'.repeat(40), [{ path: '.gm/scope/s_123.json', type: 'blob', mode: '100644', sha: null }]),
    ).resolves.toBe(7);
    await expect(
      git.openRemovalPull('a'.repeat(40), [{ path: '.gm/scope/other.json', type: 'blob', mode: '100644', sha: null }]),
    ).rejects.toThrow(/removal/);
  });

  it('removes a verified orphan cleanup branch before retrying', async () => {
    let deleted = false;
    const head = 'd'.repeat(40);
    const base = 'a'.repeat(40);
    const request = vi.fn(async (method: string, path: string): Promise<unknown> => {
      if (path.includes('/pulls?')) return [];
      if (path.includes('/matching-refs/'))
        return deleted ? [] : [{ ref: 'refs/heads/qa/cleanup-run-4', object: { sha: head } }];
      if (path.endsWith(`/git/commits/${head}`))
        return { message: 'Remove QA game qa', parents: [{ sha: base }], tree: { sha: 'b'.repeat(40) } };
      if (path.endsWith(`/git/commits/${base}`)) return { tree: { sha: 'c'.repeat(40) } };
      if (path.includes(`/git/trees/${'b'.repeat(40)}`)) return { truncated: false, tree: [] };
      if (path.includes(`/git/trees/${'c'.repeat(40)}`))
        return { truncated: false, tree: [{ path: 'games/qa/a', type: 'blob', mode: '100644', sha: 'e'.repeat(40) }] };
      if (method === 'DELETE') {
        deleted = true;
        return {};
      }
      throw new Error('unexpected request');
    });
    await expect(createQaFolderGit('example/games', 'games/qa', 'run-4', request).recover!()).resolves.toBeNull();
    expect(deleted).toBe(true);
  });

  it('builds a removal pull from main and verifies the merged pull', async () => {
    let refReads = 0;
    const request = vi.fn(async (method: string, path: string, body?: unknown): Promise<unknown> => {
      if (path.includes('/pulls?')) return [];
      if (path.endsWith('/git/ref/heads/main')) return { object: { sha: 'a'.repeat(40) } };
      if (path.includes('/git/commits/')) return { tree: { sha: 'b'.repeat(40) } };
      if (path.includes('/git/trees/') && method === 'GET')
        return { tree: [{ path: 'games/qa/a', type: 'blob', mode: '100644' }], truncated: false };
      if (path.endsWith('/git/trees') && method === 'POST') {
        expect(body).toMatchObject({ base_tree: 'b'.repeat(40), tree: [{ path: 'games/qa/a', sha: null }] });
        return { sha: 'c'.repeat(40) };
      }
      if (path.endsWith('/git/commits') && method === 'POST') return { sha: 'd'.repeat(40) };
      if (path.endsWith('/git/refs') && method === 'POST') return {};
      if (path.endsWith('/pulls') && method === 'POST') return { number: 7 };
      if (path.endsWith('/pulls/7/merge') && method === 'PUT') return { merged: true };
      if (path.includes('/git/refs/heads/qa/cleanup-') && method === 'DELETE') return {};
      if (path.includes('/git/matching-refs/heads/qa/cleanup-'))
        return refReads++ === 0 ? [{ ref: 'refs/heads/qa/cleanup-run-1', object: { sha: 'd'.repeat(40) } }] : [];
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const git = createQaFolderGit('example/games', 'games/qa', 'run-1', request);
    expect(await git.hasOpenCreationPull()).toBe(false);
    const main = await git.readMain();
    const pull = await git.openRemovalPull(main.sha, [{ path: 'games/qa/a', type: 'blob', mode: '100644', sha: null }]);
    await git.mergePull(pull);
    expect(request).toHaveBeenCalledWith('PUT', '/repos/example/games/pulls/7/merge', {
      merge_method: 'squash',
      sha: 'd'.repeat(40),
    });
    expect(request).toHaveBeenCalledWith('DELETE', '/repos/example/games/git/refs/heads/qa/cleanup-run-1');
  });

  it('waits for required checks without changing the cleanup pull head', async () => {
    let attempts = 0;
    const head = 'd'.repeat(40);
    const request = vi.fn(async (method: string, path: string): Promise<unknown> => {
      if (path.includes('/git/commits/')) return { tree: { sha: 'b'.repeat(40) } };
      if (path.endsWith('/git/trees')) return { sha: 'c'.repeat(40) };
      if (path.endsWith('/git/commits')) return { sha: head };
      if (path.endsWith('/git/refs')) return {};
      if (path.endsWith('/pulls')) return { number: 7 };
      if (path.endsWith('/pulls/7/merge')) {
        if (attempts++ === 0) throw new QaGitHubError(405);
        return { merged: true };
      }
      if (path.endsWith('/pulls/7')) return { state: 'open', mergeable: true, head: { sha: head } };
      if (path.includes('/matching-refs/')) return [];
      throw new Error(`unexpected request ${method}`);
    });
    const sleep = vi.fn(async () => undefined);
    const git = createQaFolderGit('example/games', 'games/qa', 'run-2', request, { sleep });
    const number = await git.openRemovalPull('a'.repeat(40), [
      { path: 'games/qa/a', type: 'blob', mode: '100644', sha: null },
    ]);
    await git.mergePull(number);
    expect(attempts).toBe(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('recovers only a matching removal pull and rejects mixed changes', async () => {
    const pull = {
      number: 8,
      title: 'Remove QA game qa',
      body: 'Remove the QA game folder games/qa.',
      state: 'open',
      merged_at: null,
      changed_files: 1,
      head: { ref: 'qa/cleanup-run-3', sha: 'd'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    const request = vi.fn(async (_method: string, path: string): Promise<unknown> => {
      if (path.includes('/pulls?')) return [pull];
      if (path.endsWith('/pulls/8')) return pull;
      if (path.includes('/files?')) return [{ filename: 'games/qa/file', status: 'removed' }];
      if (path.includes('/matching-refs/'))
        return [{ ref: 'refs/heads/qa/cleanup-run-3', object: { sha: 'd'.repeat(40) } }];
      throw new Error('unexpected request');
    });
    const git = createQaFolderGit('example/games', 'games/qa', 'run-3', request);
    await expect(git.recover!()).resolves.toEqual({ pull: 8, head: 'd'.repeat(40), merged: false });
    const bad = vi.fn(async (method: string, path: string) =>
      path.includes('/files?') ? [{ filename: 'games/other/file', status: 'removed' }] : request(method, path),
    );
    await expect(createQaFolderGit('example/games', 'games/qa', 'run-3', bad).recover!()).rejects.toThrow(/diff/);
  });
});
