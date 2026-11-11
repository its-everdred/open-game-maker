import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { captureMetadataPath } from '../src/look/run-provenance.js';
import { gm, tempDir } from './helpers.js';

const state = vi.hoisted(() => ({ priorOutputs: [] as string[][] }));

vi.mock('../src/look/run-provenance.js', async (original) => {
  const real = await original<typeof import('../src/look/run-provenance.js')>();
  return {
    ...real,
    prepareVerifiedSource: (cwd: string, _build: () => void, outputs: string[]) => {
      state.priorOutputs.push(outputs);
      return real.cleanHead(cwd, outputs)!;
    },
  };
});

vi.mock('@ogm/gm-verify', async (original) => {
  const real = await original<typeof import('@ogm/gm-verify')>();
  const report = { verdict: 'pass', renderer: 'test', frames: [{ path: 'phone/t2.png', t: 2 }] };
  const capture = (out: string) => {
    mkdirSync(join(out, 'phone'), { recursive: true });
    writeFileSync(join(out, 'phone/t2.png'), 'capture');
    writeFileSync(join(out, 'state.json'), '{}');
  };
  return {
    ...real,
    serveStatic: async () => ({ url: 'http://127.0.0.1:43171/', close: async () => {} }),
    runVerify: async ({ outDir }: { outDir: string }) => {
      capture(outDir);
      return { report, reportPath: join(outDir, 'report.json') };
    },
    newRunId: () => 'test-run',
    submitRequest: (cwd: string) => {
      const out = join(cwd, '.gm/queue-output');
      capture(out);
      return out;
    },
    waitForReport: async () => report,
  };
});

it.each([false, true])('records frame provenance through gm run (queue: %s)', async (queue) => {
  const root = tempDir('gm-verified-run-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  git('init', '-q');
  writeFileSync(join(root, 'gm.manifest.json'), '{}');
  git('add', 'gm.manifest.json');
  git('commit', '-qm', 'game');
  state.priorOutputs = [];
  const args = queue ? ['run', '--verify-source'] : ['run', '--verify-source', '--out', 'captures'];
  const options = { cwd: root, env: queue ? { GM_VERIFY_QUEUE: '1' } : {} };
  const result = await gm(args, options);
  expect(result.code).toBe(0);
  const frame = join(root, queue ? '.gm/queue-output/phone/t2.png' : 'captures/phone/t2.png');
  const metadata = JSON.parse(readFileSync(captureMetadataPath(root, frame), 'utf8'));
  expect(metadata.source).toBe(git('rev-parse', 'HEAD').trim());
  expect(metadata.blob).toMatch(/^[0-9a-f]{40}$/);
  expect((await gm(args, options)).code).toBe(0);
  if (!queue) expect(state.priorOutputs[1]).toEqual(expect.arrayContaining([frame, join(root, 'captures/state.json')]));
});
