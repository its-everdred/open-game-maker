import { gameIssueLabel } from '../labels.js';
import { GitHubRequestError } from '../github-request.js';
import type { CommitResult } from '../types.js';
import { refused } from '../result.js';
import type { OperationContext } from './context.js';
import type { ExtractCommitOp } from './operation-types.js';

const PLATFORM_LABELS = ['bug', 'source:report', 'needs-triage'];
const inFlight = new Map<string, Promise<CommitResult>>();

/*
 * Platform bugs go to the configured platform repository; a report about one game lands in the instance repository
 * with that game's label. Either way the issue never carries a dispatch label: user text must not drive a daemon with
 * platform write access.
 */
export async function fileIssue(op: ExtractCommitOp<'file_issue'>, context: OperationContext): Promise<CommitResult> {
  if (!op.idempotencyKey) return fileIssueOnce(op, context);
  const key = JSON.stringify([op.gameId ?? null, op.idempotencyKey]);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = fileIssueOnce(op, context).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

async function fileIssueOnce(op: ExtractCommitOp<'file_issue'>, context: OperationContext): Promise<CommitResult> {
  if (op.labels.some((label) => !PLATFORM_LABELS.includes(label))) {
    return refused('denylist', 'platform issue labels are not allowed');
  }
  if (op.reconcile && !op.idempotencyKey) return refused('denylist', 'reconciliation requires an idempotency key');

  const gameId = op.gameId;
  const repository = gameId === undefined ? null : await context.repos.resolve(gameId);
  const target = repository ?? context.platformIssueRepo;
  const labels = repository === null ? op.labels : [...new Set([...op.labels, gameIssueLabel(repository.slug)])];
  const github = await context.app.forOwner(target.owner);
  if (labels.includes('needs-triage')) {
    try {
      await github.request('GET /repos/{owner}/{repo}/labels/{name}', {
        owner: target.owner,
        repo: target.name,
        name: 'needs-triage',
      });
    } catch (error) {
      if (!(error instanceof GitHubRequestError) || error.status !== 404) throw error;
      try {
        await github.request('POST /repos/{owner}/{repo}/labels', {
          owner: target.owner,
          repo: target.name,
          name: 'needs-triage',
          color: 'ededed',
        });
      } catch (creationError) {
        if (!(creationError instanceof GitHubRequestError) || creationError.status !== 422) throw creationError;
        await github.request('GET /repos/{owner}/{repo}/labels/{name}', {
          owner: target.owner,
          repo: target.name,
          name: 'needs-triage',
        });
      }
    }
  }
  const marker = op.idempotencyKey ? `<!-- ogm-report:${op.idempotencyKey} -->` : undefined;
  if (op.reconcile && marker) {
    for (let page = 1; ; page += 1) {
      const existing = await github.request<{ number: number; body: string | null; pull_request?: unknown }[]>(
        'GET /repos/{owner}/{repo}/issues',
        { owner: target.owner, repo: target.name, state: 'all', per_page: 100, page },
      );
      const found = existing.data.find((issue) => !issue.pull_request && issue.body?.includes(marker));
      if (found) return { ok: true, sha: `issue:${found.number}` };
      if (existing.data.length < 100) break;
    }
  }
  const response = await github.request<{ number: number }>('POST /repos/{owner}/{repo}/issues', {
    owner: target.owner,
    repo: target.name,
    title: op.title,
    body: marker ? `${op.body}\n\n${marker}` : op.body,
    labels,
  });
  return { ok: true, sha: `issue:${response.data.number}` };
}
