import type { NewGamePrivateContext } from './qa-new-game-checks.js';

export type QaGameReport = {
  game: { id: string; slug: string | null; path: string | null; repoUrl: string | null };
  jobs: {
    id: string;
    kind: string;
    state: string;
    releasedAt: string | null;
    repo: string | null;
    issue: number | null;
  }[];
  daemon: { status: string; repo: string } | null;
  tickets: { jobId: string; key: string; repo: string; issue: number }[];
  sessions: { id: string; jobId: string }[];
};

/** Internal-only QA and context reads; the caller must never log the token or the private context. */
export class NewGameQaApi {
  constructor(
    private readonly base: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetcher(`${this.base}${path}`, {
      headers: { 'x-ogm-internal': this.token },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return (await response.json()) as T;
  }

  report(gameId: string): Promise<QaGameReport> {
    return this.get(`/internal/qa/new-games/${encodeURIComponent(gameId)}`);
  }

  games(): Promise<{ games: { id: string }[]; repo: string }> {
    return this.get('/internal/qa/new-games');
  }

  async cancelJob(jobId: string, cookie: { name: string; value: string }): Promise<void> {
    if (!/^j_[A-Za-z0-9_-]+$/u.test(jobId)) throw new Error('invalid QA job ID');
    const response = await this.fetcher(`${this.base}/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers: { cookie: `${cookie.name}=${cookie.value}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`QA job cancellation returned ${response.status}`);
  }

  context(requestId: string): Promise<NewGamePrivateContext> {
    return this.get(`/internal/new-game/requests/${encodeURIComponent(requestId)}`);
  }

  async deleteGame(
    gameId: string,
    folder: string,
    jobs: string[],
    tickets: QaGameReport['tickets'],
    sessions: QaGameReport['sessions'],
    fenceOwner: string,
  ): Promise<void> {
    const response = await this.fetcher(`${this.base}/internal/qa/new-games/${encodeURIComponent(gameId)}`, {
      method: 'DELETE',
      headers: { 'x-ogm-internal': this.token, 'content-type': 'application/json' },
      body: JSON.stringify({ folder, jobs, tickets, sessions, remoteClean: true, daemonStopped: true, fenceOwner }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`QA game deletion returned ${response.status}`);
  }
}
