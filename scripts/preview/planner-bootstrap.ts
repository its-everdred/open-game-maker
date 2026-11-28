// Trusted repository hook: fetch a planner child's pinned checkpoint and private answers through its workspace grant.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  constants,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export async function bootstrapPlanner(workspace: string, ticket: string, game: string, token: string): Promise<void> {
  const context = join(workspace, '.gm/context');
  const preview = join(workspace, '.gm/preview');
  const gm = join(workspace, '.gm');
  const gmFd = openSync(gm, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  if (readlinkSync(`/proc/self/fd/${gmFd}`) !== gm) {
    closeSync(gmFd);
    throw new Error('unsafe workspace context');
  }
  let contextFd: number;
  let previewFd: number;
  try {
    mkdirSync(`/proc/self/fd/${gmFd}/preview`, { recursive: true, mode: 0o700 });
    contextFd = openSync(context, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      previewFd = openSync(
        `/proc/self/fd/${gmFd}/preview`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      closeSync(contextFd);
      throw error;
    }
  } catch (error) {
    closeSync(gmFd);
    throw error;
  }
  const contextPath = `/proc/self/fd/${contextFd}`;
  const previewPath = `/proc/self/fd/${previewFd}`;
  const name = randomUUID();
  const request = join(previewPath, `${name}.json`);
  const pending = join(previewPath, `${name}.tmp`);
  const reply = join(previewPath, `${name}.response`);
  try {
    if (readlinkSync(contextPath) !== context || readlinkSync(previewPath) !== preview)
      throw new Error('unsafe workspace context');
    const sha = execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(
      pending,
      JSON.stringify({
        state: 'pending',
        token,
        ticket,
        slug: game,
        sha,
        branch: 'main',
        kind: 'planner-worker-context',
      }),
      { mode: 0o600, flag: 'wx' },
    );
    renameSync(pending, request);
    const deadline = Date.now() + 60_000;
    let result: { plannerChild?: unknown; base?: { branch?: unknown; sha?: unknown }; answers?: unknown } | undefined;
    while (Date.now() < deadline) {
      await sleep(500);
      let fd: number;
      try {
        fd = openSync(reply, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1_000_000) throw new Error('unsafe planner reply');
        let response: { state?: string; result?: typeof result };
        try {
          response = JSON.parse(readFileSync(fd, 'utf8')) as typeof response;
        } catch {
          continue;
        }
        if (response.state !== 'done') throw new Error('planner context refused');
        result = response.result;
        break;
      } finally {
        closeSync(fd);
      }
    }
    if (!result || result.plannerChild !== true || !result.base || !Array.isArray(result.answers))
      throw new Error('planner context unavailable');
    const { branch, sha: pinned } = result.base;
    if (
      typeof branch !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch) ||
      branch.includes('..') ||
      branch.includes('//') ||
      typeof pinned !== 'string' ||
      !/^[a-f0-9]{40}$/.test(pinned)
    )
      throw new Error('invalid planner checkpoint');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    let contains = false;
    try {
      git('merge-base', '--is-ancestor', pinned, 'HEAD');
      contains = true;
    } catch {
      /* Fetch and check only in a fresh workspace. */
    }
    if (!contains) {
      if (
        git('status', '--porcelain', '--untracked-files=no') ||
        git('rev-parse', 'HEAD') !== git('rev-parse', `origin/${process.env.THIS_BASE_BRANCH ?? 'main'}`)
      )
        throw new Error('planner checkpoint requires a fresh workspace');
      git('fetch', '--no-tags', 'origin', `refs/heads/${branch}`);
      git('merge-base', '--is-ancestor', pinned, 'FETCH_HEAD');
      const currentBranch = git('symbolic-ref', '--short', 'HEAD');
      git('checkout', '-B', currentBranch, pinned);
    }
    if (readlinkSync(contextPath) !== context) throw new Error('unsafe workspace context');
    const temp = join(contextPath, `.planner-answers-${name}.tmp`);
    try {
      writeFileSync(temp, JSON.stringify({ answers: result.answers }), { mode: 0o600, flag: 'wx' });
      renameSync(temp, join(contextPath, 'planner-answers.json'));
    } finally {
      rmSync(temp, { force: true });
    }
  } finally {
    rmSync(request, { force: true });
    rmSync(pending, { force: true });
    rmSync(reply, { force: true });
    closeSync(previewFd);
    closeSync(contextFd);
    closeSync(gmFd);
  }
}
