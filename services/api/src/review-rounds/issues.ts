import { createIssuesClient } from '@ogm/builder';

export type ReviewIssues = {
  setFidelity(repo: string, ticket: string, phase: string, effort: string): Promise<void>;
  close(repo: string, ticket: string): Promise<void>;
  cancel(repo: string, ticket: string): Promise<void>;
};

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
    async setFidelity(repo, ticket, phase, effort) {
      if (
        !/^[1-9]\d{0,15}$/u.test(ticket) ||
        !['mock', 'prototype', 'build', 'polish'].includes(phase) ||
        !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)
      )
        throw new Error('invalid_fidelity_labels');
      const path = `${repoPath(repo)}/issues/${ticket}/labels`;
      const desired = [`phase:${phase}`, `model:${effort}`];
      const existing: string[] = [];
      for (let page = 1; ; page += 1) {
        const items = await request('GET', `${path}?per_page=100&page=${page}`);
        if (!Array.isArray(items) || items.some((item) => !item || typeof item.name !== 'string'))
          throw new Error('github_review_invalid_response');
        existing.push(...items.map((item) => item.name as string));
        if (items.length < 100) break;
      }
      const controlled = /^(?:phase:.+|model:(?:low|medium|high|xhigh|max))$/u;
      for (const label of existing.filter((name) => controlled.test(name) && !desired.includes(name)))
        await request('DELETE', `${path}/${encodeURIComponent(label)}`);
      const missing = desired.filter((name) => !existing.includes(name));
      for (const label of missing) await labels.ensureLabel(repo, label);
      if (missing.length) await request('POST', path, { labels: missing });
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
