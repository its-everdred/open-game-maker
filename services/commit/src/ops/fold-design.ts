import { GitHubRequestError } from '../github-request.js';
import { mainHead } from '../boundary/inputs.js';
import { normalizeCommitPath } from '../paths.js';
import { refused } from '../result.js';
import type { CommitResult } from '../types.js';
import type { OperationContext } from './context.js';
import { createCommit, createTreeFromFiles } from './git-data.js';
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
 * Folds a game's design files into the instance repository. A game's paths are relative to its own folder, so this is
 * where they get the `games/<slug>/` prefix; the path guard then refuses anything that lands outside that folder. A
 * promotion is the exception: its paths are repository-relative and must sit under `packages/`.
 */
export async function foldDesign(op: ExtractCommitOp<'fold_design'>, context: OperationContext): Promise<CommitResult> {
  const repository = await context.repos.resolve(op.gameId);
  const folder = repository.path;
  const files = [];
  for (const file of op.files) {
    let path: string;
    try {
      const relative = normalizeCommitPath(file.path);
      const alreadyPrefixed = relative === folder || relative.startsWith(`${folder}/`);
      path = op.promotion === true || alreadyPrefixed ? relative : `${folder}/${relative}`;
    } catch {
      return refused('path', 'unsafe repository path', file.path);
    }
    files.push({ path, content: file.content });
  }

  const github = await context.app.forOwner(repository.owner);
  const identity = await context.app.identity();
  let base = op.base;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const verdict = await context.gate.evaluate({
      kind: op.kind,
      gameId: op.gameId,
      repository,
      files,
      sha: base,
      gamePath: folder,
      ...(op.promotion === true ? { promotion: true } : {}),
    });
    if (!verdict.allowed) return { ok: false, verdict };

    try {
      const parent = await github.request<CommitData>('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
        ...repository,
        repo: repository.name,
        commit_sha: base,
      });
      const tree = await createTreeFromFiles(github.request, repository, files, parent.data.tree.sha);
      const sha = await createCommit(github.request, repository, `design: fold ${op.gameId}`, tree, identity, [base]);
      await github.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
        ...repository,
        repo: repository.name,
        ref: 'heads/main',
        sha,
        force: false,
      });
      return { ok: true, sha };
    } catch (error) {
      if (!isNonFastForward(error)) throw error;
      if (attempt === 2) return refused('denylist', 'main moved during design fold');
      base = await mainHead(github.request, repository);
    }
  }
  return refused('denylist', 'main moved during design fold');
}
