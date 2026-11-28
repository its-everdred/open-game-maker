import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DecisionInventory, duplicateDecisionQuestions } from '@ogm/contracts';

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/u;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;
export type PlannerBase = { branch: string; sha: string };
export const plannerCheckpointBranch = (sha: string) => `ogm/planner-checkpoints/${sha}`;
export type PlannerBaseVerifier = (
  repo: string,
  workspace: string,
  slug: string,
  base: PlannerBase,
  decisions: unknown,
) => Promise<boolean>;

/** The grant binds the workspace to the planner; check its live HEAD and the corresponding pushed ref. */
export function plannerBaseVerifier(token: string, fetcher: typeof fetch = fetch): PlannerBaseVerifier {
  return async (repo, workspace, slug, base, decisions) => {
    if (
      !token ||
      !SHA.test(base.sha) ||
      !BRANCH.test(base.branch) ||
      base.branch === 'main' ||
      base.branch.includes('..') ||
      base.branch.includes('//')
    )
      return false;
    const [owner, name] = repo.split('/');
    if (!owner || !name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) return false;
    try {
      const options = { encoding: 'utf8' as const, timeout: 15_000, maxBuffer: 4096 };
      const [head, branch] = await Promise.all([
        exec('git', ['-C', workspace, 'rev-parse', 'HEAD'], options),
        exec('git', ['-C', workspace, 'symbolic-ref', '--short', 'HEAD'], options),
      ]);
      if (head.stdout.trim() !== base.sha || branch.stdout.trim() !== base.branch) return false;
      await exec('git', ['check-ref-format', '--branch', base.branch], options);
      const status = await exec(
        'git',
        [
          '-C',
          workspace,
          'status',
          '--porcelain',
          '--untracked-files=all',
          '--',
          `games/${slug}/docs/decisions.json`,
          `games/${slug}/design/decisions.json`,
        ],
        options,
      );
      if (status.stdout.trim() !== '') return false;
      const headers = {
        accept: 'application/vnd.github+json',
        authorization: `token ${token}`,
        'x-github-api-version': '2022-11-28',
      };
      const prefix = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
      const optionsHttp = { headers, signal: AbortSignal.timeout(15_000) };
      const ref = await fetcher(`${prefix}/git/ref/heads/${encodeURIComponent(base.branch)}`, optionsHttp);
      if (!ref.ok || ((await ref.json()) as { object?: { sha?: string } }).object?.sha !== base.sha) return false;
      const compare = await fetcher(`${prefix}/compare/main...${base.sha}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (
        !compare.ok ||
        !['ahead', 'identical', 'behind', 'diverged'].includes(
          ((await compare.json()) as { status?: string }).status ?? '',
        )
      )
        return false;
      const inventory = await fetcher(
        `${prefix}/contents/games/${encodeURIComponent(slug)}/docs/decisions.json?ref=${base.sha}`,
        { headers, signal: AbortSignal.timeout(15_000) },
      );
      if (!inventory.ok) return false;
      const file = (await inventory.json()) as { type?: string; encoding?: string; size?: number; content?: string };
      if (
        file.type !== 'file' ||
        file.encoding !== 'base64' ||
        typeof file.size !== 'number' ||
        file.size < 1 ||
        file.size > 256_000 ||
        typeof file.content !== 'string'
      )
        return false;
      const parsed = DecisionInventory.safeParse(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
      if (!parsed.success || !Array.isArray(decisions) || !decisions.every((id) => typeof id === 'string'))
        return false;
      if (duplicateDecisionQuestions(parsed.data).length) return false;
      if (!decisions.every((id) => parsed.data.some((entry) => entry.id === id))) return false;
      // Keep an immutable ref reachable even after the planner's working branch is deleted.
      const retained = plannerCheckpointBranch(base.sha);
      const refUrl = `${prefix}/git/ref/heads/${encodeURIComponent(retained)}`;
      let retainedRef = await fetcher(refUrl, { headers, signal: AbortSignal.timeout(15_000) });
      if (retainedRef.status === 404) {
        await fetcher(`${prefix}/git/refs`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ ref: `refs/heads/${retained}`, sha: base.sha }),
          signal: AbortSignal.timeout(15_000),
        });
        retainedRef = await fetcher(refUrl, { headers, signal: AbortSignal.timeout(15_000) });
      }
      return retainedRef.ok && ((await retainedRef.json()) as { object?: { sha?: string } }).object?.sha === base.sha;
    } catch {
      return false;
    }
  };
}
