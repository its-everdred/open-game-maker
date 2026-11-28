import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env as processEnv } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('checks out a registered child checkpoint and writes answers through the scoped relay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ogm-registered-checkpoint-'));
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const workspace = join(root, 'workspace');
  const env = {
    ...processEnv,
    PATH: (processEnv.PATH ?? '')
      .split(':')
      .filter((dir) => !dir.includes('/.aiur-runtime/'))
      .join(':'),
  };
  const git = (...args: string[]) => execFileSync('git', args, { env, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '--bare', '-q', remote);
  git('init', '-q', '-b', 'main', seed);
  git('-C', seed, 'config', 'user.name', 'Fixture');
  git('-C', seed, 'config', 'user.email', 'fixture@example.test');
  writeFileSync(join(seed, 'base.txt'), 'base');
  git('-C', seed, 'add', 'base.txt');
  git('-C', seed, 'commit', '-qm', 'base');
  git('-C', seed, 'remote', 'add', 'origin', remote);
  git('-C', seed, 'push', '-q', 'origin', 'main');
  git('-C', seed, 'checkout', '-qb', 'ogm/checkpoint');
  mkdirSync(join(seed, 'games/castle/docs'), { recursive: true });
  writeFileSync(join(seed, 'games/castle/docs/decisions.json'), '[]\n');
  git('-C', seed, 'add', 'games/castle/docs/decisions.json');
  git('-C', seed, 'commit', '-qm', 'checkpoint');
  const sha = git('-C', seed, 'rev-parse', 'HEAD');
  git('-C', seed, 'push', '-q', 'origin', 'ogm/checkpoint');
  git('clone', '-q', '-b', 'main', remote, workspace);
  git('-C', workspace, 'checkout', '-qb', 'aiur/13');
  mkdirSync(join(workspace, '.gm/context'), { recursive: true });
  const hook = fileURLToPath(new URL('../../../../scripts/preview/repository-hook.ts', import.meta.url));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\necho '{"state":"open","labels":[{"name":"game:castle"},{"name":"ogm:planner-child"}]}'\n`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const child = spawn(process.execPath, [hook, 'create'], {
    cwd: workspace,
    env: {
      ...env,
      PATH: `${bin}:${env.PATH}`,
      HOME: root,
      THIS_BASE_BRANCH: 'main',
      THIS_REPOSITORY_URL: 'https://github.com/fixture/game.git',
      AIUR_HOOK_TICKET_IDENTIFIER: '13',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (part: Buffer) => (stderr += part.toString()));
  const completed = new Promise<number | null>((resolve) => child.on('close', resolve));
  const preview = join(workspace, '.gm/preview');
  const deadline = Date.now() + 30_000;
  let request: string | undefined;
  while (Date.now() < deadline && !request) {
    try {
      request = readdirSync(preview).find((name) => name.endsWith('.json'));
    } catch {
      /* Hook has not created its directory yet. */
    }
    if (!request) await sleep(100);
  }
  expect(request).toBeDefined();
  const payload = JSON.parse(readFileSync(join(preview, request!), 'utf8'));
  expect(payload).toMatchObject({ ticket: '13', slug: 'castle', kind: 'planner-worker-context' });
  writeFileSync(
    join(preview, request!.replace(/\.json$/, '.response')),
    JSON.stringify({
      state: 'done',
      result: {
        plannerChild: true,
        base: { branch: 'ogm/checkpoint', sha },
        answers: [{ question: 'Door?', answer: 'Wood' }],
      },
    }),
  );
  expect(await completed, stderr).toBe(0);
  expect(git('-C', workspace, 'rev-parse', 'HEAD')).toBe(sha);
  expect(
    JSON.parse(readFileSync(join(workspace, '.gm/context/planner-answers.json'), 'utf8')).answers[0],
  ).toMatchObject({ answer: 'Wood' });
  git('-C', workspace, 'config', 'user.name', 'Fixture');
  git('-C', workspace, 'config', 'user.email', 'fixture@example.test');
  writeFileSync(join(workspace, 'child.txt'), 'work');
  git('-C', workspace, 'add', 'child.txt');
  git('-C', workspace, 'commit', '-qm', 'child');
  const childSha = git('-C', workspace, 'rev-parse', 'HEAD');
  const resumed = spawn(process.execPath, [hook, 'create'], {
    cwd: workspace,
    env: {
      ...env,
      PATH: `${bin}:${env.PATH}`,
      HOME: root,
      THIS_BASE_BRANCH: 'main',
      THIS_REPOSITORY_URL: 'https://github.com/fixture/game.git',
      AIUR_HOOK_TICKET_IDENTIFIER: '13',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let resumedError = '';
  resumed.stderr.on('data', (part: Buffer) => (resumedError += part.toString()));
  const resumedDone = new Promise<number | null>((resolve) => resumed.on('close', resolve));
  let retry: string | undefined;
  const retryDeadline = Date.now() + 30_000;
  while (Date.now() < retryDeadline && !retry) {
    retry = readdirSync(preview).find((name) => name.endsWith('.json'));
    if (!retry) await sleep(100);
  }
  expect(retry).toBeDefined();
  writeFileSync(
    join(preview, retry!.replace(/\.json$/, '.response')),
    JSON.stringify({
      state: 'done',
      result: { plannerChild: true, base: { branch: 'ogm/checkpoint', sha }, answers: [] },
    }),
  );
  expect(await resumedDone, resumedError).toBe(0);
  expect(git('-C', workspace, 'rev-parse', 'HEAD')).toBe(childSha);
}, 60_000);
