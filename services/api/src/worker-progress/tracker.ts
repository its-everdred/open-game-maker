type Repository = { owner: string; name: string };
export type TrackerTicket = {
  ticket: string;
  title: string;
  labels: string[];
  closedAt: string | null;
  outcome: string;
  url: string;
};

// Cache one shared repository snapshot so every game and browser does not poll GitHub separately.
export function createTrackerReader(token: string, fetcher: typeof fetch = globalThis.fetch) {
  const cache = new Map<string, { expires: number; tickets: TrackerTicket[]; stale: boolean }>();
  const retryAfter = new Map<string, number>();
  const pending = new Map<string, Promise<TrackerTicket[]>>();
  return async (repo: Repository, state: 'open' | 'closed'): Promise<{ tickets: TrackerTicket[]; stale: boolean }> => {
    const key = `${repo.owner}/${repo.name}:${state}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return { tickets: cached.tickets, stale: cached.stale };
    if ((retryAfter.get(key) ?? 0) > Date.now()) {
      if (cached) return { tickets: cached.tickets, stale: true };
      throw new Error('Ticket tracker temporarily unavailable');
    }
    const existing = pending.get(key);
    if (existing) {
      try {
        return { tickets: await existing, stale: false };
      } catch (error) {
        if (cached) return { tickets: cached.tickets, stale: true };
        throw error;
      }
    }
    const request = (async () => {
      const path = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues`;
      const tickets: TrackerTicket[] = [];
      for (let page = 1; ; page += 1) {
        const response = await fetcher(`${path}?state=${state}&per_page=100&page=${page}`, {
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `token ${token}`,
            'x-github-api-version': '2022-11-28',
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`Ticket request failed (${response.status})`);
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error('Invalid ticket response');
        for (const row of rows) {
          if (!row || row.pull_request || !Number.isInteger(row.number) || typeof row.title !== 'string') continue;
          const labels: string[] = Array.isArray(row.labels)
            ? row.labels.flatMap((label: { name?: unknown }) => (typeof label?.name === 'string' ? [label.name] : []))
            : [];
          tickets.push({
            ticket: String(row.number),
            title: row.title,
            labels,
            closedAt: typeof row.closed_at === 'string' ? row.closed_at : null,
            outcome:
              row.state_reason === 'not_planned'
                ? 'Cancelled'
                : row.state_reason === 'completed'
                  ? 'Completed'
                  : 'Closed',
            url: `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues/${row.number}`,
          });
        }
        if (rows.length < 100) break;
      }
      cache.set(key, { expires: Date.now() + 60_000, tickets, stale: false });
      retryAfter.delete(key);
      return tickets;
    })();
    pending.set(key, request);
    try {
      return { tickets: await request, stale: false };
    } catch (error) {
      // Existing scoped callers may keep the last verified snapshot on a transient tracker failure.
      retryAfter.set(key, Date.now() + 60_000);
      if (cached) {
        cache.set(key, { ...cached, expires: Date.now() + 60_000, stale: true });
        return { tickets: cached.tickets, stale: true };
      }
      throw error;
    } finally {
      pending.delete(key);
    }
  };
}
