import { normalizeBranchName } from '../paths.js';
import { refused } from '../result.js';
import type { CommitResult } from '../types.js';
import type { OperationContext } from './context.js';
import type { ExtractCommitOp } from './operation-types.js';

export async function createBranch(
  op: ExtractCommitOp<'create_branch'>,
  context: OperationContext,
): Promise<CommitResult> {
  let branch: string;
  try {
    branch = normalizeBranchName(op.branch);
  } catch {
    return refused('path', 'invalid branch name', op.branch);
  }
  const repository = await context.repos.resolve(op.gameId);
  const github = await context.app.forOwner(repository.owner);
  await github.request('POST /repos/{owner}/{repo}/git/refs', {
    ...repository,
    repo: repository.name,
    ref: `refs/heads/${branch}`,
    sha: op.sha,
  });
  return { ok: true, sha: op.sha };
}
