type Repository = { owner: string; name: string };

// Include the worker's issue comments as well as explicitly shared creator comments.
export function createTicketConversationReader(token: string, fetcher: typeof fetch = globalThis.fetch) {
  return async (repo: Repository, ticket: string, slugs: string[], owned: boolean) => {
    if (!/^[1-9]\d*$/.test(ticket)) throw new Error('invalid_ticket');
    const path = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues/${ticket}`;
    const headers = {
      accept: 'application/vnd.github+json',
      authorization: `token ${token}`,
      'x-github-api-version': '2022-11-28',
    };
    const issueResponse = await fetcher(path, { headers, signal: AbortSignal.timeout(15_000) });
    if (!issueResponse.ok) throw new Error(`Ticket request failed (${issueResponse.status})`);
    const issue: unknown = await issueResponse.json();
    if (!issue || typeof issue !== 'object' || !('labels' in issue) || !Array.isArray(issue.labels))
      throw new Error('ticket_not_found');
    const games = issue.labels.flatMap((label: { name?: unknown }) =>
      typeof label?.name === 'string' && label.name.startsWith('game:') ? [label.name.slice(5)] : [],
    );
    if (!(games.length === 1 ? slugs.includes(games[0]!) : games.length === 0 && owned))
      throw new Error('ticket_not_found');
    const messages: { text: string; at?: string }[] = [];
    for (let page = 1; ; page += 1) {
      const response = await fetcher(`${path}/comments?per_page=100&page=${page}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Ticket conversation request failed (${response.status})`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid ticket conversation response');
      for (const row of rows) {
        if (typeof row?.body !== 'string' || !row.body.trim()) continue;
        const shared = /<!--\s*gm:creator-visible\s*-->/i.test(row.body);
        const agent = /<!--\s*aiur:agent-authored\s*-->/i.test(row.body) || /^## Agent Workpad\s*$/m.test(row.body);
        if (!shared && !(agent && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(row.author_association))) continue;
        messages.push({
          text: row.body.replace(/<!--\s*(?:gm:creator-visible|aiur:agent-authored)\s*-->/gi, '').trim(),
          ...(typeof row.updated_at === 'string'
            ? { at: row.updated_at }
            : typeof row.created_at === 'string'
              ? { at: row.created_at }
              : {}),
        });
      }
      if (rows.length < 100) break;
    }
    return messages;
  };
}
