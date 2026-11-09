import { waitKeyOfLabel, waitLabel } from '@ogm/contracts';

// The GitHub side of decision waits (#680): which tickets of a game's repository carry a `waits:<key>` label, what their
// comments say, and the writes a release makes. The API talks to GitHub with the intake bot's token, the one it already
// files and labels game tickets with. It is a small fetch client of its own rather than more methods on the builder's
// IssuesClient because the generic part moves into aiur (aiur-team/aiur#7943) and this file goes with it.

export type WaitingTicket = {
  number: number;
  open: boolean;
  labels: string[];
  // Every comment body, oldest first: the `gm-waits-on` markers and any answer already written in.
  comments: string[];
};

export interface WaitTickets {
  // The keys of every `waits:` label the repository has.
  keys(repo: string): Promise<string[]>;
  waiting(repo: string, key: string): Promise<WaitingTicket[]>;
  comment(repo: string, issue: number, body: string): Promise<void>;
  setOpen(repo: string, issue: number, open: boolean): Promise<void>;
  // Takes the ticket's `waits:<key>` label off once its release is done; the label itself stays for other tickets.
  removeLabel(repo: string, issue: number, key: string): Promise<void>;
  // Deletes the repository's `waits:<key>` label once no ticket carries it.
  deleteLabel(repo: string, key: string): Promise<void>;
}

export class GitHubError extends Error {
  override name = 'GitHubError';
  constructor(readonly status: number) {
    super(`GitHub answered ${status}`);
  }
}

const API = 'https://api.github.com';
const PAGE = 100;

export function createWaitTickets(token: string, fetchImpl: typeof fetch = globalThis.fetch): WaitTickets {
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `token ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new GitHubError(response.status);
    return response.status === 204 ? null : ((await response.json()) as unknown);
  }

  async function all<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    const joiner = path.includes('?') ? '&' : '?';
    for (let page = 1; ; page += 1) {
      const batch = (await call('GET', `${path}${joiner}per_page=${PAGE}&page=${page}`)) as T[];
      items.push(...batch);
      if (batch.length < PAGE) return items;
    }
  }

  const repoPath = (repo: string) => `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;

  return {
    async keys(repo) {
      const labels = await all<{ name: string }>(`${repoPath(repo)}/labels`);
      return labels.map(({ name }) => waitKeyOfLabel(name)).filter((key) => key !== null);
    },
    async waiting(repo, key) {
      type Issue = { number: number; state: string; labels: { name: string }[]; pull_request?: unknown };
      const label = encodeURIComponent(waitLabel(key));
      const issues = await all<Issue>(`${repoPath(repo)}/issues?state=all&labels=${label}`);
      return Promise.all(
        issues
          .filter((issue) => issue.pull_request === undefined)
          .map(async (issue) => ({
            number: issue.number,
            open: issue.state === 'open',
            labels: issue.labels.map(({ name }) => name),
            comments: (await all<{ body: string | null }>(`${repoPath(repo)}/issues/${issue.number}/comments`)).map(
              ({ body }) => body ?? '',
            ),
          })),
      );
    },
    async comment(repo, issue, body) {
      await call('POST', `${repoPath(repo)}/issues/${issue}/comments`, { body });
    },
    async setOpen(repo, issue, open) {
      await call(
        'PATCH',
        `${repoPath(repo)}/issues/${issue}`,
        open ? { state: 'open' } : { state: 'closed', state_reason: 'not_planned' },
      );
    },
    async deleteLabel(repo, key) {
      try {
        await call('DELETE', `${repoPath(repo)}/labels/${encodeURIComponent(waitLabel(key))}`);
      } catch (error) {
        if (!(error instanceof GitHubError && error.status === 404)) throw error;
      }
    },
    async removeLabel(repo, issue, key) {
      try {
        await call('DELETE', `${repoPath(repo)}/issues/${issue}/labels/${encodeURIComponent(waitLabel(key))}`);
      } catch (error) {
        // Already off the ticket: a person removed it.
        if (!(error instanceof GitHubError && error.status === 404)) throw error;
      }
    },
  };
}
