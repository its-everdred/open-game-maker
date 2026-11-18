import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { renderInstanceTemplate } from '../src/index.js';

type Step = { name?: string; run?: string; if?: string };

function steps(): Step[] {
  const content = renderInstanceTemplate().files.find((entry) => entry.path === '.github/workflows/ci.yml')!.content;
  return (parse(content) as { jobs: { required: { steps: Step[] } } }).jobs.required.steps;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function put(root: string, path: string, content = ''): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** An instance with two games, a base commit, then `changes` committed on top; the playtest step runs against it. */
function runStep(changes: string[], options: { gm?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'instance-playtest-'));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root });
  git('init', '-q');
  put(root, 'package.json', '{"name":"instance","private":true}');
  for (const game of ['blobs', 'kart']) {
    put(root, `games/${game}/gm.manifest.json`, '{}');
    put(root, `games/${game}/src/main.ts`);
  }
  put(root, 'games/README.md');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  for (const path of changes) put(root, path, 'changed');
  git('add', '-A');
  git('commit', '-qm', 'change', '--allow-empty');
  const log = join(root, 'gm.log');
  if (options.gm !== false) {
    put(root, 'node_modules/.bin/gm', `#!/bin/sh\necho "$*" >> ${JSON.stringify(log)}\n`);
    chmodSync(join(root, 'node_modules/.bin/gm'), 0o755);
  }
  put(root, 'node_modules/.pnpm/@ogm+gm-verify@1/node_modules/playwright/cli.js');
  const step = steps().find((item) => item.run?.includes('gm qa playtest'))!;
  const script = step.run!.replaceAll('${{ github.event.pull_request.base.sha }}', base);
  const result = spawnSync('bash', ['-e', '-c', script], { cwd: root, encoding: 'utf8' });
  let played: string[] = [];
  try {
    played = readFileSync(log, 'utf8').trim().split('\n');
  } catch {
    /* nothing played */
  }
  return { code: result.status, played, stdout: result.stdout };
}

/* Kevin's Both-mode defects (#866) shipped because nothing played the modes a PR did not name. */
describe('instance CI playtest step', { timeout: 60_000 }, () => {
  it('runs on pull requests, after the build', () => {
    const all = steps();
    const playtest = all.findIndex((step) => step.run?.includes('gm qa playtest'));
    expect(playtest).toBeGreaterThan(all.findIndex((step) => step.run?.includes('run build')));
    expect(all[playtest]!.if).toBe("github.event_name == 'pull_request'");
  });

  it('plays every mode of only the game whose screens or play changed', () => {
    const { code, played } = runStep(['games/kart/src/main.ts']);
    expect(code).toBe(0);
    expect(played).toEqual(['qa playtest games/kart --all-modes']);
  });

  it('plays every game when the vendored core or a shared package changes', () => {
    const { code, played } = runStep(['vendor/core/gm-sdk.tgz']);
    expect(code).toBe(0);
    expect(played).toEqual(['qa playtest games/blobs --all-modes', 'qa playtest games/kart --all-modes']);
  });

  it('plays nothing for a change outside any game', () => {
    const { code, played } = runStep(['games/README.md', 'docs/notes.md']);
    expect(code).toBe(0);
    expect(played).toEqual([]);
  });

  it('fails loudly, instead of passing, when the instance has no gm CLI', () => {
    const { code, stdout } = runStep(['games/blobs/src/main.ts'], { gm: false });
    expect(code).toBe(1);
    expect(stdout).toContain('needs the vendored Game Maker core');
  });
});
