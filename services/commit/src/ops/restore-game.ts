import { GitHubRequestError } from '../github-request.js';
import { refused } from '../result.js';
import type { CommitResult } from '../types.js';
import type { OperationContext } from './context.js';
import { readGameFolder } from './game-folder.js';
import { createCommit, createTree, type TreeEntry } from './git-data.js';
import type { ExtractCommitOp } from './operation-types.js';

type CommitData = { tree: { sha: string } };

function isNonFastForward(error: unknown): boolean {
  return (
    error instanceof GitHubRequestError &&
    error.status === 422 &&
    /fast.?forward|reference update failed/iu.test(error.message)
  );
}

/*
 * Restores one game's folder from an earlier commit. The rest of the instance repository — every other game's folder
 * and the shared packages — is copied from `main`'s current tree, so a rollback can never reach outside the game.
 */
export async function restoreGame(
  op: ExtractCommitOp<'restore_game'>,
  context: OperationContext,
): Promise<CommitResult> {
  const repository = await context.repos.resolve(op.gameId);
  const folder = repository.path;
  const github = await context.app.forOwner(repository.owner);
  const identity = await context.app.identity();

  const verdict = await context.gate.evaluate({
    kind: op.kind,
    gameId: op.gameId,
    repository,
    sha: op.sha,
    gamePath: folder,
  });
  if (!verdict.allowed) return { ok: false, verdict };

  const restored = await readGameFolder({ request: github.request, repository, sha: op.sha, gamePath: folder });
  if (restored.truncated) return refused('size', 'restore source folder is too large');
  if (restored.entries.length === 0) return refused('path', 'restore commit does not contain the game folder', folder);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await github.request<{ object: { sha: string } }>('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      ...repository,
      repo: repository.name,
      ref: 'heads/main',
    });
    const base = head.data.object.sha;
    const baseCommit = await github.request<CommitData>('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
      ...repository,
      repo: repository.name,
      commit_sha: base,
    });
    const current = await readGameFolder({ request: github.request, repository, sha: base, gamePath: folder });
    const removals: TreeEntry[] = current.entries.map((entry) => ({
      path: `${folder}/${entry.path}`,
      mode: entry.mode,
      type: 'blob',
      sha: null,
    }));
    const added: TreeEntry[] = restored.entries.map((entry) => ({
      path: `${folder}/${entry.path}`,
      mode: entry.mode,
      type: 'blob',
      sha: entry.sha,
    }));
    try {
      const emptied = await createTree(github.request, repository, removals, baseCommit.data.tree.sha);
      const tree = await createTree(github.request, repository, added, emptied);
      const sha = await createCommit(github.request, repository, `restore: ${op.gameId}`, tree, identity, [base]);
      await github.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
        ...repository,
        repo: repository.name,
        ref: 'heads/main',
        sha,
        force: false,
      });
      return { ok: true, sha };
    } catch (error) {
      if (!isNonFastForward(error) || attempt === 2) throw error;
    }
  }
  return refused('denylist', 'main moved during restore');
}
