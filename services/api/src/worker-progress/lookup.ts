import type { TrackerTicket } from './tracker.js';
type Repository = { owner: string; name: string };

// A newly started ticket may be newer than the cached repository snapshot. Check its labels directly.
export function createTicketLookup(token: string, fetcher: typeof fetch = globalThis.fetch) {
  const cache = new Map<string, { expires: number; ticket: TrackerTicket | null }>();
  const retryAfter = new Map<string, number>();
  const pending = new Map<string, Promise<TrackerTicket | null>>();
  return async (repo: Repository, id: string): Promise<TrackerTicket | null> => {
    if (!/^[1-9]\d*$/.test(id)) return null;
    const key = `${repo.owner}/${repo.name}#${id}`;
    if (cache.size >= 500 && !cache.has(key)) cache.delete(cache.keys().next().value!);
    if (retryAfter.size >= 500 && !retryAfter.has(key)) retryAfter.delete(retryAfter.keys().next().value!);
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.ticket;
    if ((retryAfter.get(key) ?? 0) > Date.now()) throw new Error('Ticket lookup temporarily unavailable');
    const existing = pending.get(key);
    if (existing) return existing;
    const request = (async () => {
      const path = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues/${id}`;
      const response = await fetcher(path, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `token ${token}`,
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) {
        cache.set(key, { expires: Date.now() + 60_000, ticket: null });
        return null;
      }
      if (!response.ok) throw new Error(`Ticket lookup failed (${response.status})`);
      const row: unknown = await response.json();
      if (
        !row ||
        typeof row !== 'object' ||
        !('state' in row) ||
        row.state !== 'open' ||
        !('title' in row) ||
        typeof row.title !== 'string' ||
        !('labels' in row) ||
        !Array.isArray(row.labels)
      ) {
        cache.set(key, { expires: Date.now() + 60_000, ticket: null });
        return null;
      }
      const labels: string[] = row.labels.flatMap((label: { name?: unknown }) =>
        typeof label?.name === 'string' ? [label.name] : [],
      );
      const ticket: TrackerTicket = {
        ticket: id,
        title: row.title,
        labels,
        closedAt: null,
        updatedAt: 'updated_at' in row && typeof row.updated_at === 'string' ? row.updated_at : null,
        outcome: 'Closed',
        url: path.replace('api.github.com/repos/', 'github.com/'),
      };
      cache.set(key, { expires: Date.now() + 60_000, ticket });
      return ticket;
    })();
    pending.set(key, request);
    try {
      const ticket = await request;
      retryAfter.delete(key);
      return ticket;
    } catch (error) {
      retryAfter.set(key, Date.now() + 60_000);
      throw error;
    } finally {
      pending.delete(key);
    }
  };
}
