import type { NewGameParent } from './qa-new-game-checks.js';
import type { GitHubRequest } from './qa-new-game-folder-github.js';

export async function newGameParents(
  repo: string,
  requestId: string,
  request: GitHubRequest,
): Promise<NewGameParent[]> {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u.test(repo) || !/^j_[A-Za-z0-9_-]+$/u.test(requestId))
    throw new Error('invalid repository or request ID');
  const path = `/repos/${repo}/issues?state=all&labels=${encodeURIComponent(`request:new-game,feature:gm-${requestId}`)}&per_page=100`;
  const result = await request('GET', path);
  if (!Array.isArray(result)) throw new Error('GitHub issue lookup returned invalid data');
  if (result.length >= 100) throw new Error('GitHub issue lookup exceeds one page');
  return result.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) throw new Error('GitHub issue lookup returned invalid data');
    const issue = item as Record<string, unknown>;
    if (typeof issue.number !== 'number' || typeof issue.title !== 'string' || typeof issue.body !== 'string')
      throw new Error('GitHub issue lookup returned invalid data');
    if (!Array.isArray(issue.labels)) throw new Error('GitHub issue lookup returned invalid data');
    const labels = issue.labels.map((label: unknown) => {
      if (typeof label !== 'object' || label === null || typeof (label as { name?: unknown }).name !== 'string')
        throw new Error('GitHub issue lookup returned invalid data');
      return (label as { name: string }).name;
    });
    return { number: issue.number, repo, title: issue.title, body: issue.body, labels };
  });
}

/** Close only the exact QA request parent, and read it back before allowing later cleanup. */
export async function closeQaParent(
  repo: string,
  requestId: string,
  gameId: string,
  number: number,
  request: GitHubRequest,
): Promise<void> {
  if (!/^g_[A-Za-z0-9_-]+$/u.test(gameId) || !Number.isSafeInteger(number) || number < 1)
    throw new Error('invalid QA game or issue ID');
  const matches = await newGameParents(repo, requestId, request);
  if (matches.length !== 1 || matches[0]!.number !== number) throw new Error('QA parent is not unique');
  const parent = matches[0]!;
  if (
    !parent.labels.includes('request:new-game') ||
    !parent.labels.includes(`feature:gm-${requestId}`) ||
    !parent.body.includes(`<!-- gm-job:${requestId} gm-ticket:new-game gm-sig:`) ||
    !parent.body.split('\n').some((line) => line.trim() === `- Game: ${gameId}`) ||
    !parent.body.split('\n').some((line) => line.trim() === `- Private context reference: ${requestId}`)
  )
    throw new Error('QA parent does not match the game and request');
  const path = `/repos/${repo}/issues/${number}`;
  await request('PATCH', path, { state: 'closed' });
  const readback = (await request('GET', path)) as { state?: unknown; number?: unknown };
  if (readback.state !== 'closed' || readback.number !== number) throw new Error('QA parent closure was not verified');
}
