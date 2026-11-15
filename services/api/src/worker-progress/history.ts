type Repository = { owner: string; name: string };
export type PastTicket = { ticket: string; title: string; outcome: string; closedAt: string; url: string };

// Read the tracker's full closed issue history, not just events observed since this server started.
export function createTicketHistoryReader(
  defaultRepo: Repository,
  token: string,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const cache = new Map<string, { expires: number; tickets: PastTicket[] }>();
  return async (game: string, repo: Repository = defaultRepo): Promise<PastTicket[]> => {
    const key = `${repo.owner}/${repo.name}:${game}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.tickets;
    const path = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues`;
    const tickets: PastTicket[] = [];
    for (let page = 1; ; page += 1) {
      const response = await fetcher(
        `${path}?state=closed&sort=updated&direction=desc&per_page=100&labels=${encodeURIComponent(`game:${game}`)}&page=${page}`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `token ${token}`,
            'x-github-api-version': '2022-11-28',
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) throw new Error(`Ticket history request failed (${response.status})`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid ticket history response');
      for (const row of rows) {
        const labels = Array.isArray(row?.labels)
          ? row.labels
              .map((label: { name?: unknown }) => label?.name)
              .filter((name: unknown): name is string => typeof name === 'string' && name.startsWith('game:'))
          : [];
        if (labels.length !== 1 || labels[0] !== `game:${game}`) continue;
        if (
          !row ||
          row.pull_request ||
          !Number.isInteger(row.number) ||
          typeof row.title !== 'string' ||
          typeof row.closed_at !== 'string'
        )
          continue;
        tickets.push({
          ticket: String(row.number),
          title: row.title,
          outcome:
            row.state_reason === 'not_planned'
              ? 'Cancelled'
              : row.state_reason === 'completed'
                ? 'Completed'
                : 'Closed',
          closedAt: row.closed_at,
          url: `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues/${row.number}`,
        });
      }
      if (rows.length < 100) break;
    }
    tickets.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
    cache.set(key, { expires: Date.now() + 60_000, tickets });
    return tickets;
  };
}
