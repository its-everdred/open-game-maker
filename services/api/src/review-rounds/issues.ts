import { createIssuesClient } from '@ogm/builder';

export type ReviewIssues = {
  ensureFollowup(repo: string, slug: string, marker: string, issue: { title: string; body: string }): Promise<string>;
  close(repo: string, ticket: string): Promise<void>;
  cancel(repo: string, ticket: string): Promise<void>;
  merged(repo: string, pr: number, sha: string): Promise<boolean>;
  integrated(repo: string, sha: string): Promise<boolean>;
};

// A marker is searched on every pass, including after an indeterminate POST. No POST is retried in the same pass.
export function createReviewIssues(token: string, fetchImpl: typeof fetch = globalThis.fetch): ReviewIssues {
  const labels = createIssuesClient({ token });
  const repoPath = (repo: string) => `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;
  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `token ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`github_review_http_${response.status}`);
    return response.status === 204 ? null : ((await response.json()) as unknown);
  }
  return {
    async ensureFollowup(repo, slug, marker, issue) {
      const label = `game:${slug}`;
      await labels.ensureLabel(repo, label);
      for (let page = 1; ; page += 1) {
        const items = await request(
          'GET',
          `${repoPath(repo)}/issues?state=all&labels=${encodeURIComponent(label)}&per_page=100&page=${page}`,
        );
        if (!Array.isArray(items)) throw new Error('github_review_invalid_response');
        const match = items.find(
          (item: unknown) =>
            item &&
            typeof item === 'object' &&
            'body' in item &&
            typeof item.body === 'string' &&
            item.body.includes(marker) &&
            'number' in item &&
            typeof item.number === 'number' &&
            !('pull_request' in item),
        );
        if (match) return String(match.number);
        if (items.length < 100) break;
      }
      const created = await request('POST', `${repoPath(repo)}/issues`, { ...issue, labels: [label] });
      if (!created || typeof created !== 'object' || !('number' in created) || typeof created.number !== 'number')
        throw new Error('github_review_create_unknown');
      return String(created.number);
    },
    async merged(repo, pr, sha) {
      if (!Number.isSafeInteger(pr) || pr <= 0 || !/^[a-f0-9]{40}$/u.test(sha)) throw new Error('invalid_review_pr');
      const value = await request('GET', `${repoPath(repo)}/pulls/${pr}`);
      if (
        !value ||
        typeof value !== 'object' ||
        !('head' in value) ||
        !value.head ||
        typeof value.head !== 'object' ||
        !('sha' in value.head) ||
        value.head.sha !== sha ||
        !('merged_at' in value)
      )
        throw new Error('review_pr_changed');
      return typeof value.merged_at === 'string';
    },
    async integrated(repo, sha) {
      if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error('invalid_review_sha');
      const value = await request('GET', `${repoPath(repo)}/compare/${sha}...main`);
      if (!value || typeof value !== 'object' || !('status' in value) || typeof value.status !== 'string')
        throw new Error('github_review_invalid_response');
      if (!['identical', 'ahead', 'behind', 'diverged'].includes(value.status))
        throw new Error('github_review_invalid_response');
      return value.status === 'identical' || value.status === 'ahead';
    },
    async close(repo, ticket) {
      if (!/^[1-9]\d{0,15}$/u.test(ticket)) throw new Error('invalid_ticket');
      await request('PATCH', `${repoPath(repo)}/issues/${ticket}`, { state: 'closed', state_reason: 'completed' });
    },
    async cancel(repo, ticket) {
      if (!/^[1-9]\d{0,15}$/u.test(ticket)) throw new Error('invalid_ticket');
      await request('PATCH', `${repoPath(repo)}/issues/${ticket}`, { state: 'closed', state_reason: 'not_planned' });
    },
  };
}
