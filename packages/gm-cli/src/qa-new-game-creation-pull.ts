import type { GitHubRequest } from './qa-new-game-folder-github.js';
import { qaFolderRemovals } from './qa-new-game-folder.js';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid GitHub response');
  return value as Record<string, unknown>;
}

/** Call only after confirming that all QA jobs have stopped. Never touch a pull with other changes. */
export async function closeQaCreationPull(repo: string, folder: string, request: GitHubRequest): Promise<void> {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u.test(repo)) throw new Error('invalid QA repository');
  qaFolderRemovals(folder, [], false);
  const slug = folder.slice('games/'.length);
  const [owner] = repo.split('/');
  const root = `/repos/${repo}`;
  const query = new URLSearchParams({ state: 'open', head: `${owner}:game/${slug}`, base: 'main', per_page: '100' });
  const openPulls = await request('GET', `${root}/pulls?${query}`);
  if (!Array.isArray(openPulls) || openPulls.length > 1) throw new Error('QA creation pull is ambiguous');
  let list: unknown[] = openPulls;
  let alreadyClosed = false;
  if (list.length === 0) {
    const refs = await request('GET', `${root}/git/matching-refs/heads/game/${slug}`);
    if (!Array.isArray(refs)) throw new Error('invalid GitHub refs');
    const exact = refs.filter((value) => object(value).ref === `refs/heads/game/${slug}`);
    if (exact.length === 0) return;
    if (exact.length !== 1) throw new Error('QA creation branch is ambiguous');
    const branchSha = object(object(exact[0]).object).sha;
    query.set('state', 'closed');
    const closedPulls = await request('GET', `${root}/pulls?${query}`);
    if (!Array.isArray(closedPulls) || closedPulls.length >= 100)
      throw new Error('QA creation pull history is ambiguous');
    list = closedPulls.filter((value) => object(object(value).head).sha === branchSha);
    if (list.length !== 1) throw new Error('QA creation branch provenance needs review');
    alreadyClosed = true;
  }
  const number = object(list[0]).number;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) throw new Error('invalid QA pull');
  const pull = object(await request('GET', `${root}/pulls/${number}`));
  const head = object(pull.head);
  const base = object(pull.base);
  if (
    (alreadyClosed ? pull.state !== 'closed' : pull.state !== 'open') ||
    pull.title !== `Add game ${slug}` ||
    head.ref !== `game/${slug}` ||
    base.ref !== 'main' ||
    object(head.repo).full_name !== repo ||
    object(base.repo).full_name !== repo ||
    typeof head.sha !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(head.sha) ||
    typeof pull.changed_files !== 'number' ||
    !Number.isSafeInteger(pull.changed_files) ||
    pull.changed_files < 1 ||
    pull.changed_files > 3_000
  )
    throw new Error('QA creation pull does not match the game');
  const files: unknown[] = [];
  for (let page = 1; files.length < pull.changed_files; page += 1) {
    const batch = await request('GET', `${root}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0 || batch.length > 100)
      throw new Error('QA creation pull diff is incomplete');
    files.push(...batch);
  }
  if (
    files.length !== pull.changed_files ||
    files.some((value) => {
      const file = object(value);
      return (
        typeof file.filename !== 'string' ||
        !file.filename.startsWith(`${folder}/`) ||
        file.filename.split('/').some((part) => part === '' || part === '.' || part === '..') ||
        file.status !== 'added'
      );
    })
  )
    throw new Error('QA creation pull diff is not confined to the game folder');
  const refPath = `${root}/git/ref/heads/game/${slug}`;
  const ref = object(await request('GET', refPath));
  if (object(ref.object).sha !== head.sha) throw new Error('QA creation branch changed');
  if (!alreadyClosed) await request('PATCH', `${root}/pulls/${number}`, { state: 'closed' });
  const closed = object(await request('GET', `${root}/pulls/${number}`));
  if (closed.state !== 'closed' || object(closed.head).sha !== head.sha)
    throw new Error('QA creation pull closure was not verified');
  const beforeDelete = object(await request('GET', refPath));
  if (object(beforeDelete.object).sha !== head.sha) throw new Error('QA creation branch changed');
  const otherQuery = new URLSearchParams({ state: 'open', head: `${owner}:game/${slug}`, per_page: '100' });
  const otherPulls = await request('GET', `${root}/pulls?${otherQuery}`);
  if (!Array.isArray(otherPulls) || otherPulls.length > 0)
    throw new Error('QA creation branch is used by an open pull');
  await request('DELETE', `${root}/git/refs/heads/game/${slug}`);
  const refs = await request('GET', `${root}/git/matching-refs/heads/game/${slug}`);
  if (!Array.isArray(refs) || refs.some((value) => object(value).ref === `refs/heads/game/${slug}`))
    throw new Error('QA creation branch deletion was not verified');
}
