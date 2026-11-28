// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const lib = fileURLToPath(new URL('../tools/deploy-lib.sh', import.meta.url));
const deploy = fileURLToPath(new URL('../tools/deploy.sh', import.meta.url));
const PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;
const scratch: string[] = [];

async function dir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'ogm-deploy-lib-'));
  scratch.push(path);
  return path;
}

function bash(script: string, env: Record<string, string> = {}) {
  return spawnSync('bash', ['-c', `set -euo pipefail; source "$LIB"; ${script}`], {
    encoding: 'utf8',
    env: { PATH, HOME: tmpdir(), LIB: lib, ...env },
  });
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

// A deploy under load spent most of its time rebuilding the town and prototype art from unchanged inputs (#1264).
describe('deploy build cache', () => {
  async function build(root: string) {
    const run = bash(
      'cached "$ROOT/cache" town "$(inputs_key --public "$ROOT/src")" "$ROOT/out" -- bash -c \'cp "$ROOT/src/a" "$ROOT/out"; echo ran >>"$ROOT/runs"\'',
      { ROOT: root },
    );
    expect([run.status, run.stderr]).toEqual([0, '']);
    return run.stdout;
  }

  async function runs(root: string): Promise<number> {
    return (await readFile(join(root, 'runs'), 'utf8')).split('\n').filter(Boolean).length;
  }

  it('skips a step whose inputs and outputs are unchanged and reruns it when either changes', async () => {
    const root = await dir();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a'), 'one');

    expect(await build(root)).toMatch(/^deploy step: town \d+s\n$/);
    expect(await build(root)).toBe('deploy step: town unchanged, skipped\n');
    expect(await runs(root)).toBe(1);

    await writeFile(join(root, 'src', 'a'), 'two!');
    await build(root);
    expect(await runs(root)).toBe(2);

    await rm(join(root, 'out'));
    await build(root);
    expect(await runs(root)).toBe(3);
    expect(await build(root)).toContain('skipped');
  });

  // A manual town.sh run without --public adds licensed music to the outputs; only rerunning the step removes it.
  it('reruns a step whose outputs changed outside it, even with unchanged inputs', async () => {
    const root = await dir();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a'), 'one');
    await build(root);

    await writeFile(join(root, 'out'), 'licensed track');
    await build(root);
    expect(await runs(root)).toBe(2);
    expect(await readFile(join(root, 'out'), 'utf8')).toBe('one');
  });

  it('keys on arguments and on file times, so a flag change or a re-extracted file rebuilds', async () => {
    const root = await dir();
    const deep = join(root, 'packs', 'kenney-x', '1.0', 'extracted', 'PNG', 'a.png');
    await mkdir(join(deep, '..'), { recursive: true });
    await writeFile(deep, 'same');
    const key = (flag: string) => bash(`inputs_key ${flag} "$ROOT/packs"`, { ROOT: root }).stdout;

    const before = key('--public');
    expect(key('--public')).toBe(before);
    expect(key('--all')).not.toBe(before);
    await utimes(deep, new Date(2001, 1, 1), new Date(2001, 1, 1));
    expect(key('--public')).not.toBe(before);
  });

  // Listing every pack file took 89 s at load ~38, and other tools write cards and analysis beside the packs all day.
  it('keys --packs on each extracted folder, so only an install or re-extract rebuilds', async () => {
    const root = await dir();
    const pack = join(root, 'packs', 'kenney-x');
    const deep = join(pack, '1.0', 'extracted', 'PNG', 'a.png');
    await mkdir(join(deep, '..'), { recursive: true });
    await mkdir(join(pack, 'cards'), { recursive: true });
    await writeFile(deep, 'same');
    const key = () => bash('inputs_key --packs "$ROOT/packs"', { ROOT: root }).stdout;

    const before = key();
    await writeFile(join(pack, 'cards', 'new.card.json'), '{}');
    await writeFile(join(pack, 'pack.json'), '{}');
    await mkdir(join(pack, '1.0', 'analysis'));
    expect(key()).toBe(before);

    await mkdir(join(pack, '1.1', 'extracted'), { recursive: true });
    expect(key()).not.toBe(before);
  });

  it('still keys a tree that holds a dangling link', async () => {
    const root = await dir();
    await symlink(join(root, 'missing'), join(root, 'link'));
    const run = bash('inputs_key "$ROOT"', { ROOT: root });
    expect([run.status, run.stdout]).toEqual([0, expect.stringMatching(/^[0-9a-f]{64}\n$/)]);
  });

  it('does not record a key when the step fails, so the next deploy retries it', async () => {
    const root = await dir();
    const failed = bash('cached "$ROOT/cache" proto k "$ROOT" -- false', { ROOT: root });
    expect(failed.status).not.toBe(0);
    const retried = bash('cached "$ROOT/cache" proto k "$ROOT" -- true', { ROOT: root });
    expect(retried.stdout).toMatch(/^deploy step: proto \d+s\n$/);
  });

  it('forgets the last good key when a run with new inputs fails', async () => {
    const root = await dir();
    const step = (key: string, command: string) =>
      bash(`cached "$ROOT/cache" proto ${key} "$ROOT/cache" -- ${command}`, { ROOT: root });
    expect(step('a', 'true').status).toBe(0);
    expect(step('b', 'false').status).not.toBe(0);
    expect(step('a', 'true').stdout).toMatch(/^deploy step: proto \d+s\n$/);
  });
});

// CI's workspace job already typechecked the merged sha, so the deploy only runs tsc when that is not proven.
describe('ci_typechecked', () => {
  async function repo(): Promise<string> {
    const root = await dir();
    const git = (...args: string[]) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    git('init', '-q');
    await writeFile(join(root, 'a'), 'a');
    git('add', 'a');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'a');
    return root;
  }

  async function fakeGh(output: string, status = 0): Promise<string> {
    const bin = await dir();
    await writeFile(
      join(bin, 'gh'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >"${bin}/args"\nprintf '${output}'\nexit ${status}\n`,
      {
        mode: 0o755,
      },
    );
    return bin;
  }

  const check = (root: string, bin: string) =>
    bash('ci_typechecked "$ROOT"', { ROOT: root, PATH: `${bin}:${PATH}` }).status;

  it('passes only when the workspace check succeeded on this exact clean commit', async () => {
    const root = await repo();
    const sha = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

    const passed = await fakeGh('1');
    expect(check(root, passed)).toBe(0);
    expect(readFileSync(join(passed, 'args'), 'utf8')).toContain(`commits/${sha}/check-runs?check_name=workspace`);

    expect(check(root, await fakeGh('0'))).toBe(1);
    expect(check(root, await fakeGh('', 1))).toBe(1);

    await writeFile(join(root, 'a'), 'edited');
    expect(check(root, passed)).toBe(1);
  });
});

// The load recording no longer gates the upload, so a failure after it must reach the Executor's attention file.
describe('post-upload checks', () => {
  it('appends a failure to the attention file the QA hook remembered', async () => {
    const root = await dir();
    const attention = join(root, 'attention.log');
    await writeFile(join(root, 'attention-path'), `${attention}\n`);

    const run = bash('report_attention "load check did not report town-ready"', { OGM_QA_ROOT: root });

    expect(run.status).toBe(0);
    expect(await readFile(attention, 'utf8')).toMatch(/^\S+Z web deploy: load check did not report town-ready\n$/);
  });

  it('uploads before the load recording and does not fail the deploy on it', () => {
    const source = readFileSync(deploy, 'utf8');
    const upload = source.indexOf('netlify deploy --prod');
    const lastLoad = source.lastIndexOf('load_check');

    expect(upload).toBeGreaterThan(0);
    expect(lastLoad).toBeGreaterThan(upload);
    expect(source.slice(upload)).toMatch(
      /if timed load-check load_check; then[\s\S]*?else[\s\S]*?report_attention[\s\S]*?fi/,
    );
  });
});

describe('deploy source integrity', () => {
  it('accepts only the pinned clean commit and rejects source edits or a new head', async () => {
    const root = await dir();
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    await writeFile(join(root, 'source.txt'), 'one');
    git('add', 'source.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial');
    const sha = git('rev-parse', 'HEAD');
    const check = () => bash('source_unchanged "$ROOT" "$SHA"', { ROOT: root, SHA: sha }).status;
    expect(check()).toBe(0);
    await writeFile(join(root, 'source.txt'), 'changed');
    expect(check()).not.toBe(0);
    git('add', 'source.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'next');
    expect(check()).not.toBe(0);
  });
});
