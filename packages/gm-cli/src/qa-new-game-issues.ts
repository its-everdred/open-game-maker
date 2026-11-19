import type { GitHubRequest } from './qa-new-game-folder-github.js';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid GitHub response');
  return value as Record<string, unknown>;
}
function labels(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('invalid GitHub labels');
  return value.map((item) => {
    const name = object(item).name;
    if (typeof name !== 'string') throw new Error('invalid GitHub label');
    return name;
  });
}
function validateRepo(repo: string) {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u.test(repo)) throw new Error('invalid QA repository');
}

/** Refuse row deletion if GitHub has a job issue that the API did not checkpoint, or vice versa. */
export async function assertQaJobTickets(
  repo: string,
  jobId: string,
  expected: { key: string; issue: number }[],
  request: GitHubRequest,
) {
  validateRepo(repo);
  if (
    !/^j_[A-Za-z0-9_-]+$/u.test(jobId) ||
    expected.some(
      (ticket) =>
        !['scope', 'new-game'].includes(ticket.key) || !Number.isSafeInteger(ticket.issue) || ticket.issue < 1,
    )
  )
    throw new Error('invalid QA job checkpoint');
  const query = new URLSearchParams({ state: 'all', labels: `feature:gm-${jobId}`, per_page: '100' });
  const list = await request('GET', `/repos/${repo}/issues?${query}`);
  if (!Array.isArray(list) || list.length >= 100) throw new Error('QA job issue lookup is incomplete');
  const found = list.map((value) => {
    const issue = object(value);
    if (
      typeof issue.number !== 'number' ||
      !Number.isSafeInteger(issue.number) ||
      'pull_request' in issue ||
      typeof issue.body !== 'string' ||
      !labels(issue.labels).includes(`feature:gm-${jobId}`)
    )
      throw new Error('invalid QA job issue');
    const ticket = expected.find((item) => item.issue === issue.number);
    if (!ticket || !issue.body.includes(`<!-- gm-job:${jobId} gm-ticket:${ticket.key} gm-sig:`))
      throw new Error('QA job issue does not match its checkpoint');
    return issue.number;
  });
  if (found.length !== expected.length || new Set(found).size !== found.length)
    throw new Error('QA job issue checkpoint does not match GitHub');
}

/** Close only the one scope issue identified by the QA job, after the caller has stopped that job. */
export async function closeQaScopeIssue(repo: string, jobId: string, number: number, request: GitHubRequest) {
  validateRepo(repo);
  if (!/^j_[A-Za-z0-9_-]+$/u.test(jobId) || !Number.isSafeInteger(number) || number < 1)
    throw new Error('invalid QA job or issue');
  const path = `/repos/${repo}/issues/${number}`;
  const issue = object(await request('GET', path));
  if (
    issue.number !== number ||
    'pull_request' in issue ||
    typeof issue.body !== 'string' ||
    !issue.body.includes(`<!-- gm-job:${jobId} gm-ticket:scope gm-sig:`) ||
    !labels(issue.labels).includes(`feature:gm-${jobId}`) ||
    !['open', 'closed'].includes(String(issue.state))
  )
    throw new Error('scope issue does not match the QA job');
  if (issue.state === 'open') await request('PATCH', path, { state: 'closed' });
  const check = object(await request('GET', path));
  if (check.number !== number || check.state !== 'closed') throw new Error('scope issue closure was not verified');
}

/** Resolve the exact scope artifacts from the already verified scope issue records. */
export async function qaScopePaths(
  repo: string,
  issues: { issue: number; sessionId: string }[],
  request: GitHubRequest,
): Promise<string[]> {
  validateRepo(repo);
  const paths: string[] = [];
  for (const { issue: number, sessionId } of issues) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('invalid QA scope issue');
    if (!/^[A-Za-z0-9_-]+$/u.test(sessionId)) throw new Error('invalid QA scope session');
    const issue = object(await request('GET', `/repos/${repo}/issues/${number}`));
    if (issue.number !== number || typeof issue.body !== 'string' || !issue.body.includes('gm-ticket:scope'))
      throw new Error('invalid QA scope issue');
    const matches = [...issue.body.matchAll(/\bgm-scope:([A-Za-z0-9_-]+)/gu)];
    if (matches.length !== 1 || matches[0]![1] !== sessionId)
      throw new Error('QA scope issue session does not match the game');
    paths.push(`.gm/scope/${sessionId}.json`);
  }
  if (new Set(paths).size !== paths.length) throw new Error('duplicate QA scope session');
  return paths;
}

/** Reject unknown work targeting this daemon; do not remove its game while another ticket can dispatch. */
export async function assertNoQaIssues(repo: string, slug: string, request: GitHubRequest) {
  validateRepo(repo);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) throw new Error('invalid QA slug');
  for (let page = 1; page <= 20; page += 1) {
    const list = await request('GET', `/repos/${repo}/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(list) || list.length > 100) throw new Error('invalid GitHub issue list');
    if (list.some((item) => labels(object(item).labels).some((label) => label.startsWith(`${slug}:`))))
      throw new Error('open QA issue still targets the game daemon');
    if (list.length < 100) return;
  }
  throw new Error('GitHub issue list exceeds the safety limit');
}
