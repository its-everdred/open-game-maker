type Repository = { owner: string; name: string };

// Event IDs distinguish a new review even when both state transitions occur between tracker polls.
export function createReviewEpisodeReader(token: string, fetcher: typeof fetch = globalThis.fetch) {
  return async (repo: Repository, ticket: string, labels: readonly string[]): Promise<string | null> => {
    if (!/^[1-9]\d*$/.test(ticket)) throw new Error('Invalid ticket');
    const path = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues/${ticket}/events`;
    let latest: { id: string; at: string; active: boolean } | null = null;
    for (let page = 1; page <= 100; page++) {
      const response = await fetcher(`${path}?per_page=100&page=${page}`, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `token ${token}`,
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Review episode unavailable');
      const events: unknown = await response.json();
      if (!Array.isArray(events)) throw new Error('Invalid review episode history');
      for (const item of events) {
        if (
          !item ||
          typeof item !== 'object' ||
          (item.event !== 'labeled' && item.event !== 'unlabeled') ||
          !item.label ||
          typeof item.label.name !== 'string' ||
          !labels.includes(item.label.name)
        )
          continue;
        if ((typeof item.id !== 'number' && typeof item.id !== 'string') || typeof item.created_at !== 'string')
          throw new Error('Invalid review episode');
        if (!latest || item.created_at >= latest.at)
          latest = { id: String(item.id), at: item.created_at, active: item.event === 'labeled' };
      }
      if (events.length < 100) return latest?.active ? `${latest.id}@${latest.at}` : null;
    }
    throw new Error('Review episode history incomplete');
  };
}
