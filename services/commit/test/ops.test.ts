import { describe, expect, it, vi } from 'vitest';

import { GitHubRequestError } from '../src/github-request.js';
import { createBranch } from '../src/ops/create-branch.js';
import { fileIssue } from '../src/ops/file-issue.js';
import { foldDesign } from '../src/ops/fold-design.js';
import { merge } from '../src/ops/merge.js';
import { release } from '../src/ops/release.js';
import { restoreGame } from '../src/ops/restore-game.js';
import { setVisibility } from '../src/ops/set-visibility.js';
import { allowed } from '../src/result.js';
import type { GameRepository } from '../src/types.js';
import { fakeRequest, contextWith } from './helpers.js';

const FOLDER = 'games/castle-game';

// The folder reads that every folder-scoped operation starts with: a commit, then its recursive tree.
function folderTree(entries: { path: string; sha?: string; size?: number; type?: string }[] = []): unknown {
  return {
    truncated: false,
    tree: entries.map((entry) => ({
      path: `${FOLDER}/${entry.path}`,
      mode: '100644',
      type: entry.type ?? 'blob',
      sha: entry.sha ?? `blob-${entry.path}`,
      size: entry.size ?? 1,
    })),
  };
}

describe('fold_design', () => {
  it('prefixes game-relative paths with the game folder and retries a non-fast-forward', async () => {
    let refUpdates = 0;
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/git/commits/{commit_sha}')) return { tree: { sha: 'base-tree' } };
      if (call.route.endsWith('/git/blobs')) return { sha: 'blob-1' };
      if (call.route.endsWith('/git/trees')) return { sha: 'tree-1' };
      if (call.route.endsWith('/git/commits')) return { sha: `commit-${refUpdates + 1}` };
      if (call.route.endsWith('/git/refs/{ref}')) {
        refUpdates += 1;
        if (refUpdates === 1) throw new GitHubRequestError('Reference update failed', 422);
        return {};
      }
      if (call.route.endsWith('/git/ref/{ref}')) return { object: { sha: 'new-base' } };
      throw new Error(`unexpected route ${call.route}`);
    });
    const evaluate = vi.fn(async () => allowed());
    const result = await foldDesign(
      {
        kind: 'fold_design',
        gameId: 'game-1',
        base: 'old-base',
        files: [{ path: 'design/entities.json', content: '{}' }],
      },
      contextWith(request, { gate: { evaluate } }),
    );

    expect(result).toEqual({ ok: true, sha: 'commit-2' });
    expect(refUpdates).toBe(2);
    expect(calls.filter((call) => call.route.endsWith('/git/ref/{ref}'))).toHaveLength(1);
    expect(calls.at(-1)?.parameters).toMatchObject({ ref: 'heads/main', force: false });
    expect(calls.find((call) => call.route.endsWith('/git/trees'))?.parameters).toMatchObject({
      tree: [{ path: `${FOLDER}/design/entities.json`, mode: '100644', type: 'blob', content: '{}' }],
    });
    expect(evaluate).toHaveBeenNthCalledWith(1, {
      kind: 'fold_design',
      gameId: 'game-1',
      repository: repositoryOf(),
      files: [{ path: `${FOLDER}/design/entities.json`, content: '{}' }],
      sha: 'old-base',
      gamePath: FOLDER,
    });
    expect(evaluate).toHaveBeenNthCalledWith(2, expect.objectContaining({ sha: 'new-base' }));
  });

  it('keeps an approved promotion at the repository root under packages/', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/git/commits/{commit_sha}')) return { tree: { sha: 'base-tree' } };
      if (call.route.endsWith('/git/blobs')) return { sha: 'blob-1' };
      if (call.route.endsWith('/git/trees')) return { sha: 'tree-1' };
      if (call.route.endsWith('/git/commits')) return { sha: 'commit-1' };
      return {};
    });
    const evaluate = vi.fn(async () => allowed());
    await expect(
      foldDesign(
        {
          kind: 'fold_design',
          gameId: 'game-1',
          base: 'base',
          files: [{ path: 'packages/pack-adapters/tiles/README.md', content: 'x' }],
          promotion: true,
        },
        contextWith(request, { gate: { evaluate } }),
      ),
    ).resolves.toEqual({ ok: true, sha: 'commit-1' });
    expect(calls.find((call) => call.route.endsWith('/git/trees'))?.parameters).toMatchObject({
      tree: [{ path: 'packages/pack-adapters/tiles/README.md' }],
    });
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ promotion: true, gamePath: FOLDER }));
  });

  it('gives up after three concurrent fold updates', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/git/commits/{commit_sha}')) return { tree: { sha: 'base-tree' } };
      if (call.route.endsWith('/git/blobs')) return { sha: 'blob' };
      if (call.route.endsWith('/git/trees')) return { sha: 'tree' };
      if (call.route.endsWith('/git/commits')) return { sha: 'commit' };
      if (call.route.endsWith('/git/refs/{ref}')) throw new GitHubRequestError('not a fast-forward', 422);
      if (call.route.endsWith('/git/ref/{ref}')) return { object: { sha: 'new-base' } };
      throw new Error(`unexpected route ${call.route}`);
    });
    await expect(
      foldDesign({ kind: 'fold_design', gameId: 'game-1', base: 'base', files: [] }, contextWith(request)),
    ).resolves.toMatchObject({ ok: false, verdict: { reasons: [{ code: 'denylist' }] } });
    expect(calls.filter((call) => call.route.endsWith('/git/refs/{ref}'))).toHaveLength(3);
  });

  it('rejects an unsafe design path before making GitHub calls', async () => {
    const { request, calls } = fakeRequest(() => ({}));
    await expect(
      foldDesign(
        { kind: 'fold_design', gameId: 'game-1', base: 'base', files: [{ path: '../x', content: '' }] },
        contextWith(request),
      ),
    ).resolves.toMatchObject({ ok: false, verdict: { reasons: [{ code: 'path', path: '../x' }] } });
    expect(calls).toHaveLength(0);
  });
});

describe('restore_game', () => {
  it('replaces only the game folder on main', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/git/commits/{commit_sha}')) {
        return call.parameters.commit_sha === 'release-1'
          ? { tree: { sha: 'release-tree' } }
          : { tree: { sha: 'main-tree' } };
      }
      if (call.route.endsWith('/git/trees/{tree_sha}')) {
        return call.parameters.tree_sha === 'release-tree'
          ? folderTree([{ path: 'design/design.json', sha: 'old-blob', size: 3 }])
          : folderTree([{ path: 'design/design.json', sha: 'new-blob', size: 4 }]);
      }
      if (call.route.endsWith('/git/ref/{ref}')) return { object: { sha: 'main-2' } };
      if (call.route.endsWith('/git/trees')) return { sha: `tree-${calls.length}` };
      if (call.route.endsWith('/git/commits')) return { sha: 'restore-commit' };
      return {};
    });
    await expect(
      restoreGame({ kind: 'restore_game', gameId: 'game-1', sha: 'release-1' }, contextWith(request)),
    ).resolves.toEqual({ ok: true, sha: 'restore-commit' });

    const trees = calls.filter((call) => call.route.endsWith('/git/trees'));
    expect(trees).toHaveLength(2);
    // The current folder's files are deleted first, then the released folder's blobs are pointed at again.
    expect(trees[0]?.parameters.tree).toEqual([
      { path: `${FOLDER}/design/design.json`, mode: '100644', type: 'blob', sha: null },
    ]);
    expect(trees[1]?.parameters).toMatchObject({
      base_tree: expect.any(String) as unknown,
      tree: [{ path: `${FOLDER}/design/design.json`, mode: '100644', type: 'blob', sha: 'old-blob' }],
    });
    expect(calls.at(-1)?.parameters).toMatchObject({ ref: 'heads/main', force: false });
    expect(calls.find((call) => call.route.endsWith('/git/commits'))?.parameters).toMatchObject({
      message: 'restore: game-1',
      parents: ['main-2'],
    });
  });

  it('refuses a release commit without the game folder', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/git/commits/{commit_sha}')) return { tree: { sha: 'release-tree' } };
      if (call.route.endsWith('/git/trees/{tree_sha}')) return { truncated: false, tree: [] };
      throw new Error(`unexpected route ${call.route}`);
    });
    await expect(
      restoreGame({ kind: 'restore_game', gameId: 'game-1', sha: 'release-1' }, contextWith(request)),
    ).resolves.toMatchObject({ ok: false, verdict: { reasons: [{ code: 'path', path: FOLDER }] } });
    expect(calls.some((call) => call.route.endsWith('/git/trees'))).toBe(false);
  });
});

describe('release', () => {
  it('tags the game folder with a namespaced annotated tag', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/git/commits/{commit_sha}')) return { tree: { sha: 'release-tree' } };
      if (call.route.endsWith('/git/trees/{tree_sha}')) return folderTree([{ path: 'design/design.json' }]);
      if (call.route.endsWith('/git/tags')) return { sha: 'tag-object' };
      return {};
    });
    await expect(
      release(
        { kind: 'release', gameId: 'game-1', sha: 'commit-1', semver: '1.2.3', changelog: 'New level' },
        contextWith(request),
      ),
    ).resolves.toEqual({ ok: true, sha: 'tag-object' });
    expect(calls.find((call) => call.route.endsWith('/git/tags'))?.parameters).toMatchObject({
      tag: 'castle-game/v1.2.3',
      object: 'commit-1',
      message: 'New level',
    });
    expect(calls.find((call) => call.route.endsWith('/git/refs'))?.parameters).toMatchObject({
      ref: 'refs/tags/castle-game/v1.2.3',
      sha: 'tag-object',
    });
  });
});

describe('merge', () => {
  it('pins a squash merge to the observed pull request head', async () => {
    const { request, calls } = fakeRequest((call) =>
      call.route.startsWith('GET')
        ? { head: { sha: 'head-123' }, title: 'Add level' }
        : { merged: true, message: 'ok', sha: 'merge-456' },
    );
    await expect(merge({ kind: 'merge', gameId: 'game-1', prNumber: 7 }, contextWith(request))).resolves.toEqual({
      ok: true,
      sha: 'merge-456',
    });
    expect(calls[1]?.parameters).toMatchObject({ sha: 'head-123', merge_method: 'squash' });
  });
});

describe('set_visibility', () => {
  it('does not write a visibility change refused by the gate', async () => {
    const { request, calls } = fakeRequest(() => ({}));
    const context = contextWith(request, {
      gate: {
        async evaluate() {
          return { allowed: false, reasons: [{ code: 'denylist', detail: 'blocked' }] };
        },
      },
    });
    await expect(
      setVisibility({ kind: 'set_visibility', gameId: 'game-1', visibility: 'public' }, context),
    ).resolves.toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it('leaves the repository private when the gate allows the change', async () => {
    const { request, calls } = fakeRequest(() => ({}));
    await expect(
      setVisibility({ kind: 'set_visibility', gameId: 'game-1', visibility: 'public' }, contextWith(request)),
    ).resolves.toEqual({ ok: true, sha: 'public' });
    // The instance repository's own visibility belongs to the operator, so a game never patches it.
    expect(calls).toHaveLength(0);
  });
});

describe('create_branch', () => {
  it('creates a validated branch ref', async () => {
    const { request, calls } = fakeRequest(() => ({}));
    await expect(
      createBranch(
        { kind: 'create_branch', gameId: 'game-1', branch: 'feature/level-2', sha: 'commit-1' },
        contextWith(request),
      ),
    ).resolves.toEqual({ ok: true, sha: 'commit-1' });
    expect(calls[0]?.parameters).toMatchObject({ ref: 'refs/heads/feature/level-2', sha: 'commit-1' });
  });
});

describe('file_issue', () => {
  it('files issues only in the configured platform repository', async () => {
    const { request, calls } = fakeRequest(() => ({ number: 42 }));
    await expect(
      fileIssue(
        { kind: 'file_issue', title: 'Builder crashed', body: 'Reproduction steps', labels: ['bug', 'source:report'] },
        contextWith(request),
      ),
    ).resolves.toEqual({ ok: true, sha: 'issue:42' });
    expect(calls[0]?.parameters).toMatchObject({
      owner: 'platform',
      repo: 'bugs',
      title: 'Builder crashed',
      labels: ['bug', 'source:report'],
    });
  });

  it('refuses dispatch labels on platform issues', async () => {
    const { request, calls } = fakeRequest(() => ({ number: 42 }));
    await expect(
      fileIssue(
        { kind: 'file_issue', title: 'Builder crashed', body: 'Reproduction steps', labels: ['agent:todo'] },
        contextWith(request),
      ),
    ).resolves.toMatchObject({ ok: false, verdict: { reasons: [{ code: 'denylist' }] } });
    expect(calls).toHaveLength(0);
  });

  it('allows reports to enter the non-dispatching triage queue', async () => {
    const { request, calls } = fakeRequest(() => ({ number: 43 }));
    await expect(
      fileIssue(
        { kind: 'file_issue', title: 'Player report', body: 'Build b_1', labels: ['needs-triage'] },
        contextWith(request),
      ),
    ).resolves.toEqual({ ok: true, sha: 'issue:43' });
    expect(calls.find((call) => call.route === 'POST /repos/{owner}/{repo}/issues')?.parameters).toMatchObject({
      labels: ['needs-triage'],
    });
  });

  it('finds an earlier issue after an indeterminate filing result', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route.startsWith('GET ')) return [{ number: 43, body: 'Report\n\n<!-- ogm-report:r_1 -->' }];
      throw new Error('must not create a second issue');
    });
    await expect(
      fileIssue(
        {
          kind: 'file_issue',
          title: 'Report',
          body: 'Report',
          labels: ['needs-triage'],
          idempotencyKey: 'r_1',
          reconcile: true,
        },
        contextWith(request),
      ),
    ).resolves.toEqual({ ok: true, sha: 'issue:43' });
    expect(calls).toHaveLength(2);
  });

  it('coalesces concurrent filings of the same report', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { request, calls } = fakeRequest(async () => {
      await held;
      return { number: 44 };
    });
    const op = {
      kind: 'file_issue' as const,
      title: 'Report',
      body: 'Report',
      labels: ['needs-triage'],
      idempotencyKey: 'r_concurrent',
    };
    const context = contextWith(request);
    const first = fileIssue(op, context);
    const second = fileIssue({ ...op, reconcile: true }, context);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, sha: 'issue:44' },
      { ok: true, sha: 'issue:44' },
    ]);
    expect(calls).toHaveLength(2);
  });

  it('creates the triage label when the repository does not have it', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route === 'GET /repos/{owner}/{repo}/labels/{name}') throw new GitHubRequestError('missing', 404);
      return call.route === 'POST /repos/{owner}/{repo}/issues' ? { number: 45 } : {};
    });
    await expect(
      fileIssue(
        { kind: 'file_issue', title: 'Report', body: 'Report', labels: ['needs-triage'] },
        contextWith(request),
      ),
    ).resolves.toEqual({ ok: true, sha: 'issue:45' });
    expect(calls.map((call) => call.route)).toEqual([
      'GET /repos/{owner}/{repo}/labels/{name}',
      'POST /repos/{owner}/{repo}/labels',
      'POST /repos/{owner}/{repo}/issues',
    ]);
  });
});

function repositoryOf(): GameRepository {
  return { owner: 'alice', name: 'instance', visibility: 'private', path: FOLDER, slug: 'castle-game' };
}
