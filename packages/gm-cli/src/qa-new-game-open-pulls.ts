import type { GitHubRequest } from './qa-new-game-folder-github.js';
import { qaFolderRemovals } from './qa-new-game-folder.js';
import { sameQaRepo } from './qa-new-game-checks.js';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid GitHub response');
  return value as Record<string, unknown>;
}

/** Close only stopped scope-job PRs confined to this folder; unknown or mixed PRs block cleanup. */
export async function closeQaScopePulls(
  repo: string,
  folder: string,
  scopes: { issue: number; sessionId: string }[],
  request: GitHubRequest,
  verifiedCleanup?: { number: number; head: string },
) {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u.test(repo)) throw new Error('invalid QA repository');
  qaFolderRemovals(folder, [], false);
  if (
    scopes.some(
      ({ issue, sessionId }) => !Number.isSafeInteger(issue) || issue < 1 || !/^[A-Za-z0-9_-]+$/u.test(sessionId),
    )
  )
    throw new Error('invalid QA scope issue');
  const scopeIssues = scopes.map(({ issue }) => issue);
  const root = `/repos/${repo}`;

  async function targets() {
    const pulls: Record<string, unknown>[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const list = await request('GET', `${root}/pulls?state=open&per_page=100&page=${page}`);
      if (!Array.isArray(list) || list.length > 100) throw new Error('invalid GitHub pull list');
      pulls.push(...list.map(object));
      if (list.length < 100) break;
      if (page === 20) throw new Error('GitHub pull list exceeds the safety limit');
    }
    // Closed pulls are recovered through the known scope issue's timeline, not by scanning repository history.
    const seen = new Set(pulls.map((pull) => pull.number));
    for (const issue of scopeIssues) {
      for (let page = 1; page <= 20; page += 1) {
        const events = await request('GET', `${root}/issues/${issue}/timeline?per_page=100&page=${page}`);
        if (!Array.isArray(events) || events.length > 100) throw new Error('invalid QA issue timeline');
        for (const value of events) {
          const event = object(value);
          if (event.event !== 'cross-referenced' || !event.source) continue;
          const source = object(event.source);
          if (!source.issue) continue;
          const referenced = object(source.issue);
          if (
            !referenced.pull_request ||
            typeof referenced.number !== 'number' ||
            !Number.isSafeInteger(referenced.number)
          )
            continue;
          const pullRequest = object(referenced.pull_request);
          if (typeof pullRequest.url !== 'string') throw new Error('invalid QA issue cross-reference');
          let url: URL;
          try {
            url = new URL(pullRequest.url);
          } catch (error) {
            throw new Error('invalid QA issue cross-reference', { cause: error });
          }
          if (
            url.protocol !== 'https:' ||
            url.hostname !== 'api.github.com' ||
            url.pathname.toLowerCase() !== `${root}/pulls/${referenced.number}`.toLowerCase()
          )
            continue;
          if (seen.has(referenced.number)) continue;
          seen.add(referenced.number);
          const pull = object(await request('GET', `${root}/pulls/${referenced.number}`));
          if (pull.state === 'closed') pulls.push(pull);
        }
        if (events.length < 100) break;
        if (page === 20) throw new Error('QA issue timeline exceeds the safety limit');
      }
    }
    const matching: { number: number; branch: string; head: string; closed: boolean }[] = [];
    for (const item of pulls) {
      if (typeof item.number !== 'number' || !Number.isSafeInteger(item.number) || item.number < 1)
        throw new Error('invalid GitHub pull number');
      // Closed pulls outside the known scope issues cannot own an interrupted scope cleanup.
      if (
        item.state === 'closed' &&
        (typeof item.body !== 'string' ||
          !scopeIssues.some((number) =>
            [...(item.body as string).matchAll(/\b(?:closes|fixes|resolves)\s+#(\d+)/giu)].some(
              (match) => Number(match[1]) === number,
            ),
          ))
      )
        continue;
      const pull = object(await request('GET', `${root}/pulls/${item.number}`));
      if (
        typeof pull.changed_files !== 'number' ||
        !Number.isSafeInteger(pull.changed_files) ||
        pull.changed_files < 0 ||
        pull.changed_files > 3_000
      )
        throw new Error('GitHub pull diff exceeds the safety limit');
      const files: string[] = [];
      let hasRename = false;
      let movesFromFolder = false;
      for (let page = 1; files.length < pull.changed_files; page += 1) {
        const batch = await request('GET', `${root}/pulls/${item.number}/files?per_page=100&page=${page}`);
        if (!Array.isArray(batch) || batch.length === 0 || batch.length > 100)
          throw new Error('GitHub pull diff is incomplete');
        files.push(
          ...batch.map((value) => {
            const file = object(value);
            if (typeof file.filename !== 'string') throw new Error('invalid GitHub pull file');
            if (typeof file.previous_filename === 'string') {
              hasRename = true;
              if (file.previous_filename.startsWith(`${folder}/`)) movesFromFolder = true;
            }
            return file.filename;
          }),
        );
      }
      if (files.length !== pull.changed_files) throw new Error('GitHub pull diff is incomplete');
      const references =
        typeof pull.body === 'string'
          ? [...pull.body.matchAll(/\b(?:closes|fixes|resolves)\s+#(\d+)/giu)].map((match) => Number(match[1]))
          : [];
      const touchesFolder = movesFromFolder || files.some((file) => file.startsWith(`${folder}/`));
      const linkedScope = references.some((number) => scopeIssues.includes(number));
      if (!touchesFolder && !linkedScope) continue;
      if (hasRename) throw new Error('QA pull contains an unsupported rename');
      let scopeFile: string | undefined;
      if (linkedScope && references.length === 1) {
        const issue = object(await request('GET', `${root}/issues/${references[0]}`));
        const matches = typeof issue.body === 'string' ? [...issue.body.matchAll(/\bgm-scope:([A-Za-z0-9_-]+)/gu)] : [];
        if (
          matches.length !== 1 ||
          !scopes.some((scope) => scope.issue === references[0] && scope.sessionId === matches[0]![1])
        )
          throw new Error('QA scope issue session does not match the game');
        scopeFile = `.gm/scope/${matches[0]![1]}.json`;
      }
      if (
        files.some(
          (file) =>
            (!file.startsWith(`${folder}/`) && file !== scopeFile) ||
            file.split('/').some((part) => !part || part === '.' || part === '..'),
        )
      )
        throw new Error('QA pull contains changes outside the game folder');
      const head = object(pull.head);
      const base = object(pull.base);
      // The caller has independently verified this run's removal PR; leave it for the recovery/merge step.
      if (verifiedCleanup?.number === item.number) {
        if (
          head.sha !== verifiedCleanup.head ||
          !sameQaRepo(object(head.repo).full_name, repo) ||
          !sameQaRepo(object(base.repo).full_name, repo)
        )
          throw new Error('QA cleanup pull changed');
        continue;
      }
      if (
        !['open', 'closed'].includes(String(pull.state)) ||
        references.length !== 1 ||
        !scopeIssues.includes(references[0]!) ||
        !sameQaRepo(object(head.repo).full_name, repo) ||
        !sameQaRepo(object(base.repo).full_name, repo) ||
        base.ref !== 'main' ||
        typeof head.sha !== 'string' ||
        !/^[a-f0-9]{40}$/u.test(head.sha) ||
        typeof head.ref !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(head.ref) ||
        head.ref.includes('..') ||
        head.ref.endsWith('/') ||
        head.ref === 'main'
      )
        throw new Error('QA pull is not a verified scope pull');
      if (pull.state === 'closed') {
        const refs = await request('GET', `${root}/git/matching-refs/heads/${head.ref}`);
        if (!Array.isArray(refs)) throw new Error('invalid GitHub refs');
        const exact = refs.filter((value) => object(value).ref === `refs/heads/${head.ref}`);
        if (exact.length === 0) continue;
        if (exact.length !== 1 || object(object(exact[0]).object).sha !== head.sha)
          throw new Error('QA scope branch changed');
      }
      matching.push({ number: item.number, branch: head.ref, head: head.sha, closed: pull.state === 'closed' });
    }
    if (new Set(matching.map((pull) => pull.branch)).size !== matching.length)
      throw new Error('QA pulls share a branch');
    for (const target of matching) {
      if (
        pulls.some(
          (item) => item.state !== 'closed' && item.number !== target.number && object(item.head).ref === target.branch,
        )
      )
        throw new Error('QA scope branch is used by another open pull');
    }
    return matching;
  }

  for (const pull of await targets()) {
    const ref = object(await request('GET', `${root}/git/ref/heads/${pull.branch}`));
    if (object(ref.object).sha !== pull.head) throw new Error('QA scope branch changed');
    if (!pull.closed) await request('PATCH', `${root}/pulls/${pull.number}`, { state: 'closed' });
    const closed = object(await request('GET', `${root}/pulls/${pull.number}`));
    if (closed.state !== 'closed' || object(closed.head).sha !== pull.head)
      throw new Error('QA scope pull closure was not verified');
    const refs = await request('GET', `${root}/git/matching-refs/heads/${pull.branch}`);
    if (!Array.isArray(refs)) throw new Error('invalid GitHub refs');
    const exact = refs.filter((value) => object(value).ref === `refs/heads/${pull.branch}`);
    if (exact.length > 1 || (exact.length === 1 && object(object(exact[0]).object).sha !== pull.head))
      throw new Error('QA scope branch changed');
    if (exact.length === 1) {
      const owner = repo.split('/')[0]!;
      const query = new URLSearchParams({ state: 'open', head: `${owner}:${pull.branch}`, per_page: '100' });
      const open = await request('GET', `${root}/pulls?${query}`);
      if (!Array.isArray(open) || open.length !== 0) throw new Error('QA scope branch is used by another open pull');
      await request('DELETE', `${root}/git/refs/heads/${pull.branch}`);
      const remaining = await request('GET', `${root}/git/matching-refs/heads/${pull.branch}`);
      if (!Array.isArray(remaining) || remaining.some((value) => object(value).ref === `refs/heads/${pull.branch}`))
        throw new Error('QA scope branch deletion was not verified');
    }
  }
  if ((await targets()).length > 0) throw new Error('an open pull still changes the QA folder');
}
