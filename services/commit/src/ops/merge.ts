import { refused } from '../result.js';
import { GitHubRequestError } from '../github-request.js';
import type { CommitResult } from '../types.js';
import type { OperationContext } from './context.js';
import type { ExtractCommitOp } from './operation-types.js';

type PullRequest = { head: { sha: string }; title: string };
type MergeResponse = { merged: boolean; message: string; sha?: string };

export async function merge(op: ExtractCommitOp<'merge'>, context: OperationContext): Promise<CommitResult> {
  const repository = await context.repos.resolve(op.gameId);
  const github = await context.app.forOwner(repository.owner);
  const pull = await github.request<PullRequest>('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    ...repository,
    repo: repository.name,
    pull_number: op.prNumber,
  });
  const verdict = await context.gate.evaluate({
    kind: op.kind,
    gameId: op.gameId,
    repository,
    prNumber: op.prNumber,
    sha: pull.data.head.sha,
  });
  if (!verdict.allowed) return { ok: false, verdict };

  let response;
  try {
    response = await github.request<MergeResponse>('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
      ...repository,
      repo: repository.name,
      pull_number: op.prNumber,
      sha: pull.data.head.sha,
      merge_method: 'squash',
      commit_title: `${pull.data.title} (#${op.prNumber})`,
    });
  } catch (error) {
    if (error instanceof GitHubRequestError && (error.status === 405 || error.status === 409)) {
      return refused('denylist', 'not mergeable');
    }
    throw error;
  }
  if (!response.data.merged || response.data.sha === undefined) {
    return refused('denylist', `not mergeable: ${response.data.message}`);
  }
  return { ok: true, sha: response.data.sha };
}
