import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('serializes concurrent package builds against the same output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gm-build-lock-'));
  scratch.push(dir);
  await mkdir(join(dir, 'node_modules'));
  await mkdir(join(dir, 'bin'));
  const fakePnpm = join(dir, 'bin', 'pnpm');
  await writeFile(fakePnpm, '#!/bin/sh\nprintf "start\\n" >> starts\nmkdir active || exit 42\nsleep 1\nrmdir active\n');
  await chmod(fakePnpm, 0o755);
  for (const command of ['tsc', 'node']) {
    const stub = join(dir, 'bin', command);
    await writeFile(stub, '#!/bin/sh\nexit 0\n');
    await chmod(stub, 0o755);
  }
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts: { build: string };
  };
  const run = () =>
    new Promise<number | null>((resolve, reject) => {
      const child = spawn('sh', ['-c', manifest.scripts.build], {
        cwd: dir,
        env: { PATH: `${join(dir, 'bin')}:/usr/bin:/bin` },
      });
      child.on('error', reject);
      child.on('exit', resolve);
    });
  expect(await Promise.all([run(), run()])).toEqual([0, 0]);
  expect((await readFile(join(dir, 'starts'), 'utf8')).trim().split('\n')).toEqual(['start', 'start']);
}, 30_000);
