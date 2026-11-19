import { qaFolderRemovals, type QaFolderGit } from './qa-new-game-folder.js';
import { QaGitHubError } from './qa-new-game-gh-request.js';

export type GitHubRequest = (method: string, path: string, body?: unknown) => Promise<unknown>;
type ObjectValue = Record<string, unknown>;
const shaPattern = /^[a-f0-9]{40}$/u;

function object(value: unknown): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid GitHub response');
  return value as ObjectValue;
}
function sha(value: unknown): string {
  if (typeof value !== 'string' || !shaPattern.test(value)) throw new Error('invalid GitHub SHA');
  return value;
}

/** GitHub adapter for folder removal. The caller supplies a run-specific branch name and a scoped request client. */
export function createQaFolderGit(
  repo: string,
  folder: string,
  run: string,
  request: GitHubRequest,
  options: { sleep?: (ms: number) => Promise<void>; waitMs?: number } = {},
  scopePaths: readonly string[] = [],
): QaFolderGit {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u.test(repo) || !/^[a-z0-9-]{1,40}$/u.test(run))
    throw new Error('invalid QA repository or run');
  qaFolderRemovals(folder, [], false, scopePaths);
  const root = `/repos/${repo}`;
  const [owner] = repo.split('/');
  const slug = folder.slice('games/'.length);
  const branch = `qa/cleanup-${run}`;
  const body = scopePaths.length
    ? `Remove the QA game folder ${folder} and its scope artifacts.`
    : `Remove the QA game folder ${folder}.`;
  let opened: { number: number; head: string } | undefined;

  async function deleteBranch(expected: string) {
    const refs = await request('GET', `${root}/git/matching-refs/heads/${branch}`);
    if (!Array.isArray(refs)) throw new Error('invalid GitHub refs');
    const exact = refs.filter((value) => object(value).ref === `refs/heads/${branch}`);
    if (exact.length === 0) return;
    if (exact.length !== 1 || object(object(exact[0]).object).sha !== expected)
      throw new Error('QA cleanup branch changed');
    const query = new URLSearchParams({ state: 'open', head: `${owner}:${branch}`, per_page: '100' });
    const otherPulls = await request('GET', `${root}/pulls?${query}`);
    if (!Array.isArray(otherPulls) || otherPulls.length > 0)
      throw new Error('QA cleanup branch is used by an open pull');
    await request('DELETE', `${root}/git/refs/heads/${branch}`);
    const remaining = await request('GET', `${root}/git/matching-refs/heads/${branch}`);
    if (!Array.isArray(remaining) || remaining.some((value) => object(value).ref === `refs/heads/${branch}`))
      throw new Error('QA cleanup branch deletion was not verified');
  }

  async function readMain() {
    const ref = object(await request('GET', `${root}/git/ref/heads/main`));
    const head = sha(object(ref.object).sha);
    const commit = object(await request('GET', `${root}/git/commits/${head}`));
    const treeSha = sha(object(commit.tree).sha);
    const response = object(await request('GET', `${root}/git/trees/${treeSha}?recursive=1`));
    if (!Array.isArray(response.tree) || typeof response.truncated !== 'boolean')
      throw new Error('invalid GitHub tree');
    const tree = response.tree.map((item: unknown) => {
      const entry = object(item);
      if (typeof entry.path !== 'string' || typeof entry.mode !== 'string' || typeof entry.type !== 'string')
        throw new Error('invalid GitHub tree entry');
      return { path: entry.path, mode: entry.mode, type: entry.type };
    });
    return { sha: head, tree, truncated: response.truncated };
  }

  async function verifyOrphan(head: string) {
    const commit = object(await request('GET', `${root}/git/commits/${head}`));
    if (commit.message !== `Remove QA game ${slug}` || !Array.isArray(commit.parents) || commit.parents.length !== 1)
      throw new Error('QA cleanup branch has an unexpected commit');
    const parent = object(await request('GET', `${root}/git/commits/${sha(object(commit.parents[0]).sha)}`));
    async function leaves(tree: unknown) {
      const result = object(await request('GET', `${root}/git/trees/${sha(object(tree).sha)}?recursive=1`));
      if (result.truncated !== false || !Array.isArray(result.tree)) throw new Error('QA cleanup tree is incomplete');
      const entries = new Map<string, string>();
      for (const item of result.tree) {
        const entry = object(item);
        if (entry.type === 'tree') continue;
        if (typeof entry.path !== 'string' || typeof entry.mode !== 'string' || typeof entry.type !== 'string')
          throw new Error('invalid QA cleanup tree');
        if (entry.path.split('/').some((part) => !part || part === '.' || part === '..'))
          throw new Error('invalid QA cleanup path');
        if (entries.has(entry.path)) throw new Error('duplicate QA cleanup path');
        entries.set(entry.path, JSON.stringify([entry.mode, entry.type, sha(entry.sha)]));
      }
      return entries;
    }
    const before = await leaves(parent.tree);
    const after = await leaves(commit.tree);
    let removed = 0;
    for (const [path, value] of before) {
      if (after.get(path) === value) {
        after.delete(path);
        continue;
      }
      if (after.has(path) || (!path.startsWith(`${folder}/`) && !scopePaths.includes(path)))
        throw new Error('QA cleanup branch changes other files');
      removed += 1;
    }
    if (!removed || after.size) throw new Error('QA cleanup branch changes other files');
  }

  return {
    async hasOpenCreationPull() {
      const query = new URLSearchParams({
        state: 'open',
        head: `${owner}:game/${slug}`,
        base: 'main',
        per_page: '100',
      });
      const pulls = await request('GET', `${root}/pulls?${query}`);
      if (!Array.isArray(pulls)) throw new Error('invalid GitHub pull list');
      return pulls.length > 0;
    },
    async recover() {
      const query = new URLSearchParams({ state: 'all', head: `${owner}:${branch}`, base: 'main', per_page: '100' });
      const list = await request('GET', `${root}/pulls?${query}`);
      if (!Array.isArray(list) || list.length > 1) throw new Error('QA cleanup pull is ambiguous');
      if (list.length === 0) {
        const refs = await request('GET', `${root}/git/matching-refs/heads/${branch}`);
        if (!Array.isArray(refs)) throw new Error('invalid GitHub refs');
        const exact = refs.filter((value) => object(value).ref === `refs/heads/${branch}`);
        if (exact.length > 1) throw new Error('QA cleanup branch is ambiguous');
        if (exact.length === 1) {
          const head = sha(object(object(exact[0]).object).sha);
          await verifyOrphan(head);
          await deleteBranch(head);
        }
        return null;
      }
      const number = object(list[0]).number;
      if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1)
        throw new Error('invalid QA cleanup pull');
      const pull = object(await request('GET', `${root}/pulls/${number}`));
      const head = object(pull.head);
      const base = object(pull.base);
      const headSha = sha(head.sha);
      if (
        pull.title !== `Remove QA game ${slug}` ||
        pull.body !== body ||
        head.ref !== branch ||
        object(head.repo).full_name !== repo ||
        base.ref !== 'main' ||
        object(base.repo).full_name !== repo ||
        typeof pull.changed_files !== 'number' ||
        !Number.isSafeInteger(pull.changed_files) ||
        pull.changed_files < 1 ||
        pull.changed_files > 3_000
      )
        throw new Error('QA cleanup pull does not match the run');
      const files: unknown[] = [];
      for (let page = 1; files.length < pull.changed_files; page += 1) {
        const batch = await request('GET', `${root}/pulls/${number}/files?per_page=100&page=${page}`);
        if (!Array.isArray(batch) || batch.length === 0 || batch.length > 100)
          throw new Error('QA cleanup pull diff is incomplete');
        files.push(...batch);
      }
      if (
        files.length !== pull.changed_files ||
        files.some((value) => {
          const file = object(value);
          return (
            typeof file.filename !== 'string' ||
            (!file.filename.startsWith(`${folder}/`) && !scopePaths.includes(file.filename)) ||
            file.filename.split('/').some((part) => !part || part === '.' || part === '..') ||
            file.status !== 'removed' ||
            typeof file.previous_filename === 'string'
          );
        })
      )
        throw new Error('QA cleanup pull diff is not confined to the game folder');
      opened = { number, head: headSha };
      if (typeof pull.merged_at === 'string') {
        await deleteBranch(headSha);
        return { pull: number, head: headSha, merged: true };
      }
      if (pull.state !== 'open') throw new Error('QA cleanup pull closed without merging');
      const refs = await request('GET', `${root}/git/matching-refs/heads/${branch}`);
      if (!Array.isArray(refs)) throw new Error('invalid GitHub refs');
      const exact = refs.filter((value) => object(value).ref === `refs/heads/${branch}`);
      if (exact.length !== 1 || object(object(exact[0]).object).sha !== headSha)
        throw new Error('QA cleanup branch changed');
      return { pull: number, head: headSha, merged: false };
    },
    readMain,
    async openRemovalPull(base, entries) {
      sha(base);
      const expected = qaFolderRemovals(folder, entries, false, scopePaths);
      if (entries.length === 0 || expected.length !== entries.length || entries.some((entry) => entry.sha !== null))
        throw new Error('invalid QA folder removal');
      const baseCommit = object(await request('GET', `${root}/git/commits/${base}`));
      const tree = object(
        await request('POST', `${root}/git/trees`, { base_tree: sha(object(baseCommit.tree).sha), tree: entries }),
      );
      const commit = object(
        await request('POST', `${root}/git/commits`, {
          message: `Remove QA game ${slug}`,
          tree: sha(tree.sha),
          parents: [base],
        }),
      );
      const head = sha(commit.sha);
      await request('POST', `${root}/git/refs`, { ref: `refs/heads/${branch}`, sha: head });
      const pull = object(
        await request('POST', `${root}/pulls`, {
          title: `Remove QA game ${slug}`,
          head: branch,
          base: 'main',
          body,
        }),
      );
      if (typeof pull.number !== 'number' || !Number.isSafeInteger(pull.number) || pull.number < 1)
        throw new Error('invalid GitHub pull number');
      opened = { number: pull.number, head };
      return pull.number;
    },
    async mergePull(number) {
      if (!opened || opened.number !== number) throw new Error('QA cleanup pull was not opened by this run');
      const until = Date.now() + (options.waitMs ?? 15 * 60_000);
      const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
      for (;;) {
        try {
          const result = object(
            await request('PUT', `${root}/pulls/${number}/merge`, {
              merge_method: 'squash',
              sha: opened.head,
            }),
          );
          if (result.merged !== true) throw new Error('QA cleanup pull did not merge');
          break;
        } catch (error) {
          if (!(error instanceof QaGitHubError) || ![405, 409, 422].includes(error.status ?? 0)) throw error;
          const pull = object(await request('GET', `${root}/pulls/${number}`));
          if (object(pull.head).sha !== opened.head) throw new Error('QA cleanup pull head changed', { cause: error });
          if (typeof pull.merged_at === 'string') break;
          if (pull.state !== 'open' || pull.mergeable === false)
            throw new Error('QA cleanup pull cannot merge', { cause: error });
          if (Date.now() >= until) throw new Error('QA cleanup pull did not become mergeable', { cause: error });
          await sleep(5_000);
        }
      }
      await deleteBranch(opened.head);
    },
    async folderExists(path) {
      if (path !== folder) throw new Error('QA folder changed');
      const main = await readMain();
      return qaFolderRemovals(folder, main.tree, main.truncated, scopePaths).length > 0;
    },
  };
}
