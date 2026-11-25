import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { chromiumGuard } from '../src/packs/chromium-guard.js';
import { runPreviewWorker } from '../src/packs/model-preview.js';

it('terminates a stalled preview worker at the deadline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gm-preview-worker-'));
  const script = join(directory, 'hang.cjs');
  const marker = join(directory, 'runtime.txt');
  await writeFile(
    script,
    "require('node:fs').writeFileSync(process.argv[2], process.argv[3]); setInterval(() => {}, 1000);\n",
  );
  await expect(runPreviewWorker(script, [marker], 3_000)).rejects.toThrow('preview timed out');
  const runtime = await readFile(marker, 'utf8');
  await expect(stat(runtime)).rejects.toMatchObject({ code: 'ENOENT' });
}, 20_000);

it('reports a worker that disconnects unexpectedly', async () => {
  const script = join(await mkdtemp(join(tmpdir(), 'gm-preview-worker-')), 'disconnect.cjs');
  await writeFile(script, "process.kill(process.pid, 'SIGKILL');\n");
  await expect(runPreviewWorker(script, [], 5_000)).rejects.toThrow('preview worker exited');
}, 10_000);

it.skipIf(process.platform !== 'linux')(
  'kills detached descendants after a timeout',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gm-preview-tree-'));
    const script = join(directory, 'worker.cjs');
    const pidFile = join(directory, 'child.pid');
    await writeFile(
      script,
      `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
child.unref();
writeFileSync(process.argv[2], String(child.pid));
setInterval(() => {}, 1000);
`,
    );
    await expect(runPreviewWorker(script, [pidFile], 3_000)).rejects.toThrow('preview timed out');
    const pid = Number(await readFile(pidFile, 'utf8'));
    await expect
      .poll(
        async () => {
          const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
          return !stat || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ');
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  },
  20_000,
);

it.skipIf(process.platform !== 'linux')(
  'kills tracked detached descendants after the worker crashes',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gm-preview-crash-'));
    const script = join(directory, 'worker.cjs');
    const pidFile = join(directory, 'child.pid');
    await writeFile(
      script,
      `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
child.unref();
writeFileSync(process.argv[2], String(child.pid));
setTimeout(() => process.kill(process.pid, 'SIGKILL'), 1500);
`,
    );
    await expect(runPreviewWorker(script, [pidFile], 10_000)).rejects.toThrow('preview worker exited');
    const pid = Number(await readFile(pidFile, 'utf8'));
    await expect
      .poll(
        async () => {
          const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
          return !stat || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ');
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  },
  30_000,
);

it.skipIf(process.platform !== 'linux')(
  'prevents a just-spawned browser from surviving its parent',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gm-preview-parent-death-'));
    const script = join(directory, 'worker.cjs');
    const guard = join(directory, 'guard');
    const pidFile = join(directory, 'child.pid');
    const template = chromiumGuard(123456789, '/bin/sleep');
    await writeFile(
      script,
      `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
writeFileSync(process.argv[2], ${JSON.stringify(template)}.replace('parent = 123456789', 'parent = ' + process.pid), { mode: 0o700 });
const child = spawn(process.argv[2], ['60'], { detached: true, stdio: 'ignore' });
child.unref();
writeFileSync(process.argv[3], String(child.pid));
process.kill(process.pid, 'SIGKILL');
`,
    );
    await expect(runPreviewWorker(script, [guard, pidFile], 10_000)).rejects.toThrow('preview worker exited');
    const pid = Number(await readFile(pidFile, 'utf8'));
    await expect
      .poll(
        async () => {
          const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
          return !stat || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ');
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  },
  30_000,
);

it.skipIf(process.platform !== 'linux')(
  'kills the worker and browser when the invoking CLI dies',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gm-preview-cli-death-'));
    const entry = join(directory, 'entry.mjs');
    const runner = join(directory, 'runner.mjs');
    const worker = join(directory, 'worker.cjs');
    const guard = join(directory, 'browser-guard');
    const pidFile = join(directory, 'pids.json');
    const modelModule = join(process.cwd(), 'src/packs/model-preview.ts');
    await writeFile(
      entry,
      `import { runPreviewWorker } from ${JSON.stringify(modelModule)};
import { existsSync } from 'node:fs';
runPreviewWorker(process.argv[2], [process.argv[3], process.argv[4]], 30000).catch(() => {});
const timer = setInterval(() => { if (existsSync(process.argv[4])) { clearInterval(timer); process.kill(process.pid, 'SIGKILL'); } }, 50);
`,
    );
    const template = chromiumGuard(123456789, '/bin/sleep');
    await writeFile(
      worker,
      `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
writeFileSync(process.argv[2], ${JSON.stringify(template)}.replace('parent = 123456789', 'parent = ' + process.pid), { mode: 0o700 });
const child = spawn(process.argv[2], ['60'], { detached: true, stdio: 'ignore' });
child.unref();
writeFileSync(process.argv[3], JSON.stringify([process.pid, child.pid]));
setInterval(() => {}, 1000);
`,
    );
    execFileSync(join(process.cwd(), 'node_modules/.bin/esbuild'), [
      entry,
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--outfile=${runner}`,
    ]);
    const cli = spawn(process.execPath, [runner, worker, guard, pidFile], { stdio: 'ignore' });
    await once(cli, 'close');
    const pids = JSON.parse(await readFile(pidFile, 'utf8')) as number[];
    try {
      for (const pid of pids) {
        await expect
          .poll(
            async () => {
              const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
              return !stat || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ');
            },
            { timeout: 10_000 },
          )
          .toBe(true);
      }
    } finally {
      for (const pid of pids)
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
    }
  },
  60_000,
);
