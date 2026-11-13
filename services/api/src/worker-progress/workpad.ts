type Repository = { owner: string; name: string };
type CacheEntry = { body: string; expires: number };

// Only the checklist-derived count leaves the API. Comment text never reaches the player.
export function createWorkpadReader(defaultRepo: Repository, token: string, fetcher: typeof fetch = globalThis.fetch) {
  const cache = new Map<string, CacheEntry>();
  return async (ticket: string, repo: Repository = defaultRepo): Promise<string> => {
    if (!/^[1-9]\d*$/.test(ticket)) return '';
    const key = `${repo.owner}/${repo.name}#${ticket}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.body;
    const path = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues/${ticket}/comments`;
    let found = '';
    for (let page = 1; ; page += 1) {
      const response = await fetcher(`${path}?per_page=100&page=${page}`, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `token ${token}`,
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Workpad request failed (${response.status})`);
      const comments: unknown = await response.json();
      if (!Array.isArray(comments)) throw new Error('Invalid workpad response');
      for (const comment of comments) {
        if (typeof comment?.body === 'string' && /^## Agent Workpad\s*$/m.test(comment.body)) found = comment.body;
      }
      if (found || comments.length < 100) break;
    }
    if (cache.size >= 200 && !cache.has(key)) cache.delete(cache.keys().next().value!);
    cache.set(key, { body: found, expires: Date.now() + 30_000 });
    return found;
  };
}
