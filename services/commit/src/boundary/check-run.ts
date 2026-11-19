import type { BoundaryVerdict } from '@ogm/contracts';

import type { GitHubRequest, Repository } from '../types.js';

type Delay = (milliseconds: number) => Promise<void>;
type CheckRuns = {
  total_count: number;
  check_runs: { name: string; status: string; conclusion: string | null }[];
};

const defaultDelay: Delay = async (milliseconds) => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};
const MAX_REMEMBERED_HEADS = 10_000;

function line(reason: BoundaryVerdict['reasons'][number]): string {
  const location = reason.path === undefined ? '' : ` \`${reason.path}\``;
  return `- **${reason.code}**${location} — ${reason.detail}`;
}

export function checkRunOutput(verdict: BoundaryVerdict): { title: string; summary: string; text: string } {
  if (verdict.allowed) return { title: 'Boundary ok', summary: 'No repository boundary problems found.', text: '' };
  const summary = verdict.reasons.map(line).join('\n');
  const groups = new Map<string, string[]>();
  for (const reason of verdict.reasons) {
    const values = groups.get(reason.code) ?? [];
    values.push(line(reason));
    groups.set(reason.code, values);
  }
  return {
    title: `${verdict.reasons.length} boundary ${verdict.reasons.length === 1 ? 'problem' : 'problems'}`,
    summary,
    text: [...groups].map(([code, values]) => `### ${code}\n${values.join('\n')}`).join('\n\n'),
  };
}

export class BoundaryCheckPoster {
  readonly #posted = new Set<string>();
  readonly #posting = new Map<string, Promise<void>>();
  readonly #delay: Delay;

  constructor(options: { delay?: Delay } = {}) {
    this.#delay = options.delay ?? defaultDelay;
  }

  #remember(key: string): void {
    if (this.#posted.size >= MAX_REMEMBERED_HEADS) this.#posted.clear();
    this.#posted.add(key);
  }

  async exists(request: GitHubRequest, repository: Repository, headSha: string): Promise<boolean> {
    const key = `${repository.owner}/${repository.name}@${headSha}`;
    if (this.#posted.has(key)) return true;
    const response = await request<CheckRuns>('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
      ...repository,
      repo: repository.name,
      ref: headSha,
      check_name: 'ogm/boundary',
      per_page: 1,
    });
    const exists = response.data.check_runs.some(
      ({ name, status, conclusion }) =>
        name === 'ogm/boundary' && status === 'completed' && (conclusion === 'success' || conclusion === 'failure'),
    );
    if (exists) this.#remember(key);
    return exists;
  }

  post(request: GitHubRequest, repository: Repository, headSha: string, verdict: BoundaryVerdict): Promise<void> {
    const key = `${repository.owner}/${repository.name}@${headSha}`;
    const existing = this.#posting.get(key);
    if (existing !== undefined) return existing;
    const posting = this.#post(request, repository, headSha, verdict).finally(() => {
      if (this.#posting.get(key) === posting) this.#posting.delete(key);
    });
    this.#posting.set(key, posting);
    return posting;
  }

  async #post(
    request: GitHubRequest,
    repository: Repository,
    headSha: string,
    verdict: BoundaryVerdict,
  ): Promise<void> {
    const key = `${repository.owner}/${repository.name}@${headSha}`;
    if (this.#posted.has(key)) return;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (await this.exists(request, repository, headSha)) return;
        await request('POST /repos/{owner}/{repo}/check-runs', {
          ...repository,
          repo: repository.name,
          name: 'ogm/boundary',
          head_sha: headSha,
          status: 'completed',
          conclusion: verdict.allowed ? 'success' : 'failure',
          output: checkRunOutput(verdict),
        });
        this.#remember(key);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        await this.#delay(250 * 2 ** attempt);
      }
    }
  }
}
