type Repository = { owner: string; name: string };
export type WaitingTicket = { ticket: string; title: string; state: 'human-review' | 'ci-wait' | 'merging' };

// Waiting tickets are no longer running in the daemon, so read their tracker labels as well.
export function createWaitingTicketReader(token: string, fetcher: typeof fetch = globalThis.fetch) {
  const cache = new Map<string, { expires: number; tickets: WaitingTicket[] }>();
  return async (game: string, repo: Repository): Promise<WaitingTicket[]> => {
    const key = `${repo.owner}/${repo.name}:${game}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.tickets;
    const path = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues`;
    const tickets: WaitingTicket[] = [];
    for (let page = 1; ; page += 1) {
      const response = await fetcher(
        `${path}?state=open&per_page=100&labels=${encodeURIComponent(`game:${game}`)}&page=${page}`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `token ${token}`,
            'x-github-api-version': '2022-11-28',
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) throw new Error(`Waiting ticket request failed (${response.status})`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid waiting ticket response');
      for (const row of rows) {
        if (!row || row.pull_request || !Number.isInteger(row.number) || typeof row.title !== 'string') continue;
        const labels: string[] = Array.isArray(row.labels)
          ? row.labels.flatMap((label: { name?: unknown }) => (typeof label?.name === 'string' ? [label.name] : []))
          : [];
        const games = labels.filter((label) => label.startsWith('game:'));
        if (games.length !== 1 || games[0] !== `game:${game}`) continue;
        const states = labels
          .filter((label) => label.startsWith('agent:') || label.startsWith(`${game}:`))
          .map((label) => label.replace(/^[^:]+:/, ''))
          .filter((state): state is WaitingTicket['state'] => ['human-review', 'ci-wait', 'merging'].includes(state));
        if (states.length === 1) tickets.push({ ticket: String(row.number), title: row.title, state: states[0]! });
      }
      if (rows.length < 100) break;
    }
    cache.set(key, { expires: Date.now() + 5_000, tickets });
    return tickets;
  };
}
