import { describe, expect, it, vi } from 'vitest';
import { closeQaScopePulls } from '../src/qa-new-game-open-pulls.js';

describe('QA scope pull cleanup', () => {
  it('refuses a scope issue that names a different session than the QA database', async () => {
    const pull = {
      number: 9,
      state: 'open',
      body: 'Closes #42',
      changed_files: 1,
      head: { ref: 'aiur/42', sha: 'a'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    const request = vi.fn(async (_method: string, path: string): Promise<unknown> => {
      if (path.includes('/pulls?')) return [pull];
      if (path.includes('/timeline?')) return [];
      if (path.endsWith('/pulls/9')) return pull;
      if (path.endsWith('/issues/42')) return { body: '<!-- gm-scope:session-other -->' };
      if (path.includes('/files?')) return [{ filename: '.gm/scope/session-other.json' }];
      throw new Error('unexpected request');
    });
    await expect(
      closeQaScopePulls('example/games', 'games/qa', [{ issue: 42, sessionId: 'session-123' }], request),
    ).rejects.toThrow(/does not match/);
    expect(request.mock.calls.some(([method]) => method !== 'GET')).toBe(false);
  });

  it('refuses an unrelated pull that moves a file out of the QA folder', async () => {
    const pull = {
      number: 9,
      state: 'open',
      body: '',
      changed_files: 1,
      head: { ref: 'someone/branch', sha: 'a'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    const request = vi.fn(async (_method: string, path: string): Promise<unknown> => {
      if (path.includes('/pulls?')) return [pull];
      if (path.endsWith('/pulls/9')) return pull;
      if (path.includes('/files?'))
        return [{ filename: 'games/other/important', previous_filename: 'games/qa/important' }];
      throw new Error('unexpected request');
    });
    await expect(closeQaScopePulls('example/games', 'games/qa', [], request)).rejects.toThrow(/rename/);
    expect(request.mock.calls.some(([method]) => method !== 'GET')).toBe(false);
  });

  it('refuses a scope-linked pull that renames an unrelated file into its scope artifact', async () => {
    const pull = {
      number: 9,
      state: 'open',
      body: 'Closes #42',
      changed_files: 1,
      head: { ref: 'aiur/42', sha: 'a'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    const request = vi.fn(async (_method: string, path: string): Promise<unknown> => {
      if (path.includes('/pulls?')) return [pull];
      if (path.includes('/timeline?')) return [];
      if (path.endsWith('/pulls/9')) return pull;
      if (path.includes('/files?'))
        return [{ filename: '.gm/scope/session-123.json', previous_filename: 'games/other/important' }];
      throw new Error('unexpected request');
    });
    await expect(
      closeQaScopePulls('example/games', 'games/qa', [{ issue: 42, sessionId: 'session-123' }], request),
    ).rejects.toThrow(/rename/);
    expect(request.mock.calls.some(([method]) => method !== 'GET')).toBe(false);
  });

  it('finishes deleting a verified scope branch when its pull was already closed', async () => {
    const head = 'a'.repeat(40);
    const pull = {
      number: 9,
      state: 'closed',
      body: 'Closes #42',
      changed_files: 1,
      head: { ref: 'aiur/42', sha: head, repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    let deleted = false;
    const request = vi.fn(async (method: string, path: string): Promise<unknown> => {
      if (path.includes('/pulls?') && path.includes('head=')) return [];
      if (path.includes('/pulls?')) return [];
      if (path.includes('/timeline?'))
        return [
          {
            event: 'cross-referenced',
            source: {
              issue: { number: 9, pull_request: { url: 'https://api.github.com/repos/example/games/pulls/9' } },
            },
          },
        ];
      if (path.endsWith('/pulls/9')) return pull;
      if (path.endsWith('/issues/42')) return { body: '<!-- gm-scope:session-123 -->' };
      if (path.includes('/files?')) return [{ filename: '.gm/scope/session-123.json' }];
      if (path.includes('/matching-refs/'))
        return deleted ? [] : [{ ref: 'refs/heads/aiur/42', object: { sha: head } }];
      if (path.includes('/git/ref/heads/')) return { object: { sha: head } };
      if (method === 'DELETE') {
        deleted = true;
        return {};
      }
      throw new Error('unexpected request');
    });
    await closeQaScopePulls('example/games', 'games/qa', [{ issue: 42, sessionId: 'session-123' }], request);
    expect(deleted).toBe(true);
    expect(request.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
  });

  it('keeps the branch if a different PR starts using it after the original closes', async () => {
    const pull = {
      number: 9,
      state: 'open',
      body: 'Closes #42',
      changed_files: 1,
      head: { ref: 'aiur/42', sha: 'a'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    let closed = false;
    const request = vi.fn(async (method: string, path: string): Promise<unknown> => {
      if (path.includes('/timeline?')) return [];
      if (path.includes('/pulls?') && path.includes('head=')) return [{ number: 10 }];
      if (path.includes('/pulls?')) return [pull];
      if (path.endsWith('/issues/42')) return { body: '<!-- gm-scope:session-123 -->' };
      if (path.includes('/files?')) return [{ filename: 'games/qa/file' }];
      if (path.includes('/matching-refs/')) return [{ ref: 'refs/heads/aiur/42', object: { sha: 'a'.repeat(40) } }];
      if (path.includes('/git/ref/heads/')) return { object: { sha: 'a'.repeat(40) } };
      if (method === 'PATCH') {
        closed = true;
        return {};
      }
      if (path.endsWith('/pulls/9')) return { ...pull, state: closed ? 'closed' : 'open' };
      throw new Error('unexpected request');
    });
    await expect(
      closeQaScopePulls('example/games', 'games/qa', [{ issue: 42, sessionId: 'session-123' }], request),
    ).rejects.toThrow(/another open pull/);
    expect(request.mock.calls.some(([method]) => method === 'DELETE')).toBe(false);
  });

  it('finds a linked scope pull even when its artifact is outside the game folder', async () => {
    const pull = {
      number: 9,
      state: 'open',
      body: 'Closes #42',
      changed_files: 1,
      head: { ref: 'aiur/42', sha: 'a'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    let closed = false;
    let deleted = false;
    const request = vi.fn(async (method: string, path: string): Promise<unknown> => {
      if (path.includes('/timeline?')) return [];
      if (path.includes('/pulls?')) return closed ? [] : [pull];
      if (path.includes('/files?')) return [{ filename: '.gm/scope/session-123.json' }];
      if (path.endsWith('/issues/42'))
        return { body: '<!-- gm-job:j_test gm-ticket:scope gm-sig:abc gm-scope:session-123 -->' };
      if (path.includes('/matching-refs/'))
        return deleted ? [] : [{ ref: 'refs/heads/aiur/42', object: { sha: 'a'.repeat(40) } }];
      if (path.includes('/git/ref/heads/')) return { object: { sha: 'a'.repeat(40) } };
      if (method === 'PATCH') {
        closed = true;
        return {};
      }
      if (method === 'DELETE') {
        deleted = true;
        return {};
      }
      if (path.endsWith('/pulls/9')) return { ...pull, state: closed ? 'closed' : 'open' };
      throw new Error('unexpected request');
    });
    await closeQaScopePulls('example/games', 'games/qa', [{ issue: 42, sessionId: 'session-123' }], request);
    expect(request).toHaveBeenCalledWith('PATCH', '/repos/example/games/pulls/9', { state: 'closed' });
    expect(deleted).toBe(true);
  });

  it('closes a known scope pull confined to the game and refuses mixed changes', async () => {
    const pull = {
      number: 9,
      state: 'open',
      body: 'Closes #42',
      changed_files: 1,
      head: { ref: 'aiur/42', sha: 'a'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    let closed = false;
    let refDeleted = false;
    const request = vi.fn(async (method: string, path: string): Promise<unknown> => {
      if (path.includes('/timeline?')) return [];
      if (path.includes('/pulls?')) return closed ? [] : [pull];
      if (path.includes('/files?')) return [{ filename: 'games/qa/file.ts', status: 'modified' }];
      if (path.endsWith('/issues/42')) return { body: '<!-- gm-scope:session-123 -->' };
      if (path.includes('/matching-refs/'))
        return refDeleted ? [] : [{ ref: 'refs/heads/aiur/42', object: { sha: 'a'.repeat(40) } }];
      if (path.includes('/git/ref/heads/')) return { object: { sha: 'a'.repeat(40) } };
      if (method === 'PATCH') {
        closed = true;
        return {};
      }
      if (method === 'DELETE') {
        refDeleted = true;
        return {};
      }
      if (path.endsWith('/pulls/9')) return { ...pull, state: closed ? 'closed' : 'open' };
      throw new Error('unexpected request');
    });
    await closeQaScopePulls('example/games', 'games/qa', [{ issue: 42, sessionId: 'session-123' }], request);
    expect(request).toHaveBeenCalledWith('PATCH', '/repos/example/games/pulls/9', { state: 'closed' });
    const unsafe = vi.fn(async (_method: string, path: string): Promise<unknown> => {
      if (path.includes('/timeline?')) return [];
      if (path.includes('/pulls?')) return [pull];
      if (path.endsWith('/pulls/9')) return { ...pull, changed_files: 2 };
      if (path.includes('/files?')) return [{ filename: 'games/qa/file.ts' }, { filename: 'games/other/file.ts' }];
      if (path.endsWith('/issues/42')) return { body: '<!-- gm-scope:session-123 -->' };
      throw new Error('unexpected request');
    });
    await expect(
      closeQaScopePulls('example/games', 'games/qa', [{ issue: 42, sessionId: 'session-123' }], unsafe),
    ).rejects.toThrow(/outside/);
    expect(unsafe.mock.calls.some(([method]) => method !== 'GET')).toBe(false);
  });

  it('leaves a previously verified cleanup pull for recovery, but refuses a changed head', async () => {
    const pull = {
      number: 11,
      state: 'open',
      body: 'cleanup',
      changed_files: 1,
      head: { ref: 'qa/cleanup-run', sha: 'a'.repeat(40), repo: { full_name: 'example/games' } },
      base: { ref: 'main', repo: { full_name: 'example/games' } },
    };
    const request = vi.fn(async (_method: string, path: string): Promise<unknown> => {
      if (path.includes('/pulls?')) return [pull];
      if (path.includes('/files?')) return [{ filename: 'games/qa/file.ts', status: 'removed' }];
      if (path.endsWith('/pulls/11')) return pull;
      throw new Error('unexpected request');
    });
    await closeQaScopePulls('example/games', 'games/qa', [], request, { number: 11, head: 'a'.repeat(40) });
    await expect(
      closeQaScopePulls('example/games', 'games/qa', [], request, { number: 11, head: 'b'.repeat(40) }),
    ).rejects.toThrow(/changed/);
    expect(request.mock.calls.some(([method]) => method !== 'GET')).toBe(false);
  });
});
