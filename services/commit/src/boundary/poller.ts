import type { GitHubApp, Repository } from '../types.js';
import { mapConcurrent } from '../concurrency.js';
import type { ActiveRepository, BoundaryApi } from './api-client.js';
import type { PullSnapshot } from './inputs.js';
import { BoundaryApiError } from './api-client.js';
import { GitHubRequestError } from '../github-request.js';

export type BoundaryCheckRequest = {
  repository: Repository;
  pull: PullSnapshot;
  // Every game that lives in this repository: a pull request is attributed to the one game whose folder it touches.
  games: { gameId: string; path: string }[];
};

export type BoundaryCheck = (request: BoundaryCheckRequest) => Promise<void>;
type Log = (line: Record<string, unknown>) => void;
type Pull = { number: number; draft: boolean; head: { sha: string } };
const POLL_CONCURRENCY = 4;

function errorDetails(error: unknown): Record<string, unknown> {
  return {
    error: error instanceof Error ? error.name : 'UnknownError',
    ...(error instanceof BoundaryApiError ? { reason: error.reason, status: error.status } : {}),
    ...(error instanceof GitHubRequestError ? { status: error.status } : {}),
  };
}

async function openPulls(app: GitHubApp, repository: Repository): Promise<Pull[]> {
  const github = await app.forOwner(repository.owner);
  const pulls: Pull[] = [];
  for (let page = 1; ; page += 1) {
    const response = await github.request<Pull[]>('GET /repos/{owner}/{repo}/pulls', {
      ...repository,
      repo: repository.name,
      state: 'open',
      per_page: 100,
      page,
    });
    pulls.push(...response.data);
    if (response.data.length < 100) return pulls;
  }
}

function repositoryOf(active: ActiveRepository): Repository {
  return { owner: active.owner, name: active.name, visibility: active.visibility };
}

// Games share one repository, so the open pull requests of a repository are checked once against all its games.
export function groupActiveRepositories(
  active: ActiveRepository[],
): { repository: Repository; games: { gameId: string; path: string }[] }[] {
  const groups = new Map<string, { repository: Repository; games: { gameId: string; path: string }[] }>();
  for (const entry of active) {
    const key = `${entry.owner}/${entry.name}`.toLocaleLowerCase();
    const group = groups.get(key) ?? { repository: repositoryOf(entry), games: [] };
    group.games.push({ gameId: entry.gameId, path: entry.path });
    groups.set(key, group);
  }
  return [...groups.values()];
}

export async function runBoundaryPoll(options: {
  api: Pick<BoundaryApi, 'activeRepositories'>;
  app: GitHubApp;
  check: BoundaryCheck;
  log: Log;
}): Promise<void> {
  const groups = groupActiveRepositories(await options.api.activeRepositories());
  await mapConcurrent(groups, POLL_CONCURRENCY, async ({ repository, games }) => {
    try {
      const pulls = await openPulls(options.app, repository);
      await mapConcurrent(pulls, POLL_CONCURRENCY, async (pull) => {
        try {
          await options.check({
            repository,
            pull: { number: pull.number, draft: pull.draft, headSha: pull.head.sha },
            games,
          });
        } catch (error) {
          options.log({
            event: 'boundary-poll-error',
            repo: `${repository.owner}/${repository.name}`,
            pull: pull.number,
            ...errorDetails(error),
          });
        }
      });
    } catch (error) {
      options.log({
        event: 'boundary-poll-error',
        repo: `${repository.owner}/${repository.name}`,
        ...errorDetails(error),
      });
    }
  });
}

export function startBoundaryPoller(options: {
  api: Pick<BoundaryApi, 'activeRepositories'>;
  app: GitHubApp;
  check: BoundaryCheck;
  log: Log;
  intervalMs?: number;
}): { stop(): void } {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runBoundaryPoll(options);
    } catch (error) {
      options.log({
        event: 'boundary-poll-error',
        ...errorDetails(error),
      });
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), options.intervalMs ?? 60_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
