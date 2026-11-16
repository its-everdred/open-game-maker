import { request as octokitRequest } from '@octokit/request';

export type GitHubResponse = {
  status: number;
  data: unknown;
  headers: Record<string, string | number | undefined>;
};

export type GitHubRequest = (route: string, parameters: Record<string, unknown>) => Promise<GitHubResponse>;

export type FoundIssue = { number: number; url: string; labels: string[] };

export interface IssuesClient {
  hasPrototypeSkill(repo: string, coreRepo?: string): Promise<boolean>;
  create(
    repo: string,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<{ number: number; url: string }>;
  findByMarkers(repo: string, jobId: string, key: string): Promise<FoundIssue | null>;
  ensureLabel(repo: string, name: string, color?: string, description?: string): Promise<void>;
  labels(repo: string, issueNumber: number): Promise<string[]>;
  addLabel(repo: string, issueNumber: number, name: string): Promise<void>;
  removeLabel(repo: string, issueNumber: number, name: string): Promise<void>;
  // `prefix` is the daemon's lifecycle-label prefix: a game daemon writes `<game-slug>:<state>`, never `agent:<state>`.
  setStateLabel(
    repo: string,
    issueNumber: number,
    state: 'todo' | 'cancelled' | 'paused',
    prefix?: string,
  ): Promise<void>;
}

export class OutcomeUnknownError extends Error {
  constructor(
    readonly repo: string,
    readonly jobId: string,
    readonly key: string,
  ) {
    super(`GitHub accepted the issue write without returning a number for ${repo} ${jobId}/${key}`);
    this.name = 'OutcomeUnknownError';
  }
}

class GitHubIssuesError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly data: unknown,
    readonly headers: Record<string, string | number | undefined>,
  ) {
    super(message);
    this.name = 'GitHubIssuesError';
  }
}

type IssuesClientDeps = {
  token: string;
  request?: GitHubRequest;
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createIssuesClient(deps: IssuesClientDeps): IssuesClient {
  const sleep = deps.sleep ?? realSleep;
  const authenticated = octokitRequest.defaults({ headers: { authorization: `token ${deps.token}` } });
  const request: GitHubRequest =
    deps.request ??
    (async (route, parameters) => (await authenticated(route, parameters)) as unknown as GitHubResponse);

  async function call(route: string, parameters: Record<string, unknown>): Promise<GitHubResponse> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await request(route, parameters);
      } catch (error) {
        const normalized = normalizeError(error, deps.token);
        if (attempt >= 3 || !retryable(normalized)) throw normalized;
        await sleep(retryDelay(normalized, attempt));
      }
    }
  }

  return {
    async hasPrototypeSkill(repo, coreRepo) {
      const game = splitRepo(repo);
      try {
        const manifest = record(
          (
            await call('GET /repos/{owner}/{repo}/contents/{path}', {
              owner: game.owner,
              repo: game.name,
              path: 'vendor/core.json',
            })
          ).data,
        );
        if (manifest.encoding !== 'base64' || typeof manifest.content !== 'string') return false;
        const core = record(record(JSON.parse(Buffer.from(manifest.content, 'base64').toString('utf8'))).core);
        if (typeof core.sha !== 'string' || !/^[a-f0-9]{40}$/u.test(core.sha)) return false;
        let canonical = coreRepo;
        if (!canonical && typeof core.source === 'string') {
          const url = new URL(core.source);
          if (
            url.protocol !== 'https:' ||
            url.hostname !== 'github.com' ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            return false;
          canonical = url.pathname.replace(/^\//u, '').replace(/\.git$/u, '');
        }
        // A minimal core pin has no source field; it refers to the upstream core unless the instance config overrides it.
        canonical ??= 'its-everdred/open-game-maker';
        const parts = splitRepo(canonical);
        const skill = record(
          (
            await call('GET /repos/{owner}/{repo}/contents/{path}', {
              owner: parts.owner,
              repo: parts.name,
              path: 'skills/gm-prototype/SKILL.md',
              ref: core.sha,
            })
          ).data,
        );
        return skill.type === 'file';
      } catch (error) {
        if (error instanceof GitHubIssuesError && error.status === 404) return false;
        if (error instanceof SyntaxError || error instanceof TypeError) return false;
        throw error;
      }
    },
    async create(repo, issue) {
      const { owner, name } = splitRepo(repo);
      const result = await call('POST /repos/{owner}/{repo}/issues', { owner, repo: name, ...issue });
      const data = record(result.data);
      if (typeof data.number !== 'number') {
        const marker = markers(issue.body);
        throw new OutcomeUnknownError(repo, marker.jobId, marker.key);
      }
      return { number: data.number, url: typeof data.html_url === 'string' ? data.html_url : '' };
    },

    async findByMarkers(repo, jobId, key) {
      const { owner, name } = splitRepo(repo);
      const result = await call('GET /repos/{owner}/{repo}/issues', {
        owner,
        repo: name,
        labels: `feature:gm-${jobId}`,
        state: 'all',
        per_page: 100,
      });
      if (!Array.isArray(result.data)) return null;
      const marker = `gm-job:${jobId} gm-ticket:${key} `;
      for (const value of result.data) {
        const issue = record(value);
        if (typeof issue.number !== 'number' || typeof issue.body !== 'string' || !issue.body.includes(marker))
          continue;
        return {
          number: issue.number,
          url: typeof issue.html_url === 'string' ? issue.html_url : '',
          labels: labelNames(issue.labels),
        };
      }
      return null;
    },

    async ensureLabel(repo, name, color = '0e8a16', description = '') {
      const parts = splitRepo(repo);
      try {
        await call('POST /repos/{owner}/{repo}/labels', {
          owner: parts.owner,
          repo: parts.name,
          name,
          color,
          description,
        });
      } catch (error) {
        if (error instanceof GitHubIssuesError && error.status === 422 && alreadyExists(error.data)) return;
        throw error;
      }
    },

    async labels(repo, issueNumber) {
      const parts = splitRepo(repo);
      const result = await call('GET /repos/{owner}/{repo}/issues/{issue_number}', {
        owner: parts.owner,
        repo: parts.name,
        issue_number: issueNumber,
      });
      return labelNames(record(result.data).labels);
    },

    async addLabel(repo, issueNumber, name) {
      const parts = splitRepo(repo);
      await call('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
        owner: parts.owner,
        repo: parts.name,
        issue_number: issueNumber,
        labels: [name],
      });
    },

    async removeLabel(repo, issueNumber, name) {
      const parts = splitRepo(repo);
      try {
        await call('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', {
          owner: parts.owner,
          repo: parts.name,
          issue_number: issueNumber,
          name,
        });
      } catch (error) {
        if (error instanceof GitHubIssuesError && error.status === 404) return;
        throw error;
      }
    },

    async setStateLabel(repo, issueNumber, state, prefix = 'agent') {
      const target = `${prefix}:${state}`;
      await this.ensureLabel(repo, target);
      const current = await this.labels(repo, issueNumber);
      for (const label of current.filter((label) => label.startsWith(`${prefix}:`) && label !== target)) {
        await this.removeLabel(repo, issueNumber, label);
      }
      if (!current.includes(target)) await this.addLabel(repo, issueNumber, target);
    },
  };
}

function splitRepo(repo: string): { owner: string; name: string } {
  const match = /^([^/]+)\/([^/]+)$/.exec(repo);
  if (!match) throw new TypeError(`Invalid GitHub repository: ${repo}`);
  return { owner: match[1]!, name: match[2]! };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((label) => {
    if (typeof label === 'string') return [label];
    const name = record(label).name;
    return typeof name === 'string' ? [name] : [];
  });
}

function markers(body: string): { jobId: string; key: string } {
  const match = /gm-job:([^\s]+)\s+gm-ticket:([^\s]+)\s+gm-sig:/.exec(body);
  return { jobId: match?.[1] ?? 'unknown', key: match?.[2] ?? 'unknown' };
}

function normalizeError(error: unknown, token: string): GitHubIssuesError {
  if (error instanceof GitHubIssuesError) return error;
  const value = record(error);
  const response = record(value.response);
  const status =
    typeof value.status === 'number' ? value.status : typeof response.status === 'number' ? response.status : undefined;
  const data = response.data;
  const rawHeaders = record(response.headers);
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).flatMap(([name, header]) =>
      typeof header === 'string' || typeof header === 'number' ? [[name.toLowerCase(), header] as const] : [],
    ),
  );
  const rawMessage = error instanceof Error ? error.message : String(error);
  return new GitHubIssuesError(rawMessage.replaceAll(token, '[REDACTED]'), status, data, headers);
}

function retryable(error: GitHubIssuesError): boolean {
  if (error.status !== undefined && error.status >= 500) return true;
  return (
    error.status === 403 &&
    (header(error.headers, 'retry-after') !== undefined || header(error.headers, 'x-ratelimit-remaining') === '0')
  );
}

function retryDelay(error: GitHubIssuesError, attempt: number): number {
  const retryAfter = Number(header(error.headers, 'retry-after'));
  return Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
}

function header(headers: Record<string, string | number | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return value === undefined ? undefined : String(value);
}

function alreadyExists(value: unknown): boolean {
  const data = record(value);
  if (typeof data.message === 'string' && /already[_ ]exists/i.test(data.message)) return true;
  return Array.isArray(data.errors) && data.errors.some((error) => record(error).code === 'already_exists');
}
