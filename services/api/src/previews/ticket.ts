export type PreviewTicketVerifier = (
  repo: string,
  ticket: string,
  game: string,
  requireGameLabel: boolean,
) => Promise<boolean>;

/** Recheck every upload so a closed ticket or changed game label immediately revokes its credential. */
export function previewTicketVerifier(token: string, fetcher: typeof fetch = fetch): PreviewTicketVerifier {
  return async (repo, ticket, game, requireGameLabel) => {
    if (!token) return false;
    const [owner, name] = repo.split('/');
    if (!owner || !name) return false;
    try {
      const response = await fetcher(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${ticket}`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `token ${token}`,
            'x-github-api-version': '2022-11-28',
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) return false;
      const issue = (await response.json()) as { state?: string; labels?: { name?: string }[] };
      const games = issue.labels?.map((label) => label.name).filter((name) => name?.startsWith('game:')) ?? [];
      return (
        issue.state === 'open' &&
        ((games.length === 0 && !requireGameLabel) || (games.length === 1 && games[0] === `game:${game}`))
      );
    } catch {
      return false;
    }
  };
}
