import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getPriority } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import { assertWorkerRecord } from '../src/packs/tag.js';
import {
  effectiveWorkers,
  resolvePython,
  runJsonWorker,
  workerEnvironment,
  WorkerError,
} from '../src/packs/workers.js';
import { tempDir } from './helpers.js';

describe('pack workers', () => {
  it('accepts preserved human-reviewed card records', () => {
    expect(() =>
      assertWorkerRecord({ card: 'packs/example/cards/asset.card.json', status: 'reviewed', flags: [] }),
    ).not.toThrow();
  });

  it('falls back to the legacy audio venv when the new venv is absent', async () => {
    const repo = tempDir('gm-python-');
    const legacy = join(repo, 'scripts/audio/.venv/bin/python');
    mkdirSync(dirname(legacy), { recursive: true });
    writeFileSync(legacy, '', { mode: 0o755 });
    expect(await resolvePython(repo)).toBe(legacy);
    const primary = join(repo, 'scripts/py/audio/.venv/bin/python');
    mkdirSync(dirname(primary), { recursive: true });
    writeFileSync(primary, '', { mode: 0o755 });
    expect(await resolvePython(repo)).toBe(primary);
  });

  it('clamps requested workers to one third of logical cores', () => {
    expect(effectiveWorkers(32, 12)).toBe(4);
    expect(effectiveWorkers(0, 12)).toBe(4);
    expect(effectiveWorkers(0, 2)).toBe(1);
    expect(effectiveWorkers(2, 12)).toBe(2);
  });

  it('builds an exact offline environment without provider credentials', () => {
    const environment = workerEnvironment({
      assetsRoot: '/assets',
      eventsFile: '/events.jsonl',
      workers: 4,
      home: '/home/test',
    });
    expect(environment).toEqual({
      PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
      HOME: '/home/test',
      OGM_ASSETS_ROOT: '/assets',
      GM_EVENTS_FILE: '/events.jsonl',
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
      TOKENIZERS_PARALLELISM: 'false',
      OGM_TORCH_THREADS: '4',
      OMP_NUM_THREADS: '4',
      MKL_NUM_THREADS: '4',
      OPENBLAS_NUM_THREADS: '4',
      NUMEXPR_NUM_THREADS: '4',
    });
    expect(environment).not.toHaveProperty('OPENAI_API_KEY');
    expect(environment).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
  });

  it('runs under nice, streams records, and captures bounded diagnostics', async () => {
    const directory = tempDir('gm-worker-');
    const worker = join(directory, 'worker.mjs');
    writeFileSync(
      worker,
      `import os from 'node:os';
       console.log(JSON.stringify({file:'one',status:'ok',priority:os.getPriority(0)}));
       console.error('worker summary');`,
    );
    chmodSync(worker, 0o700);
    const records: Record<string, unknown>[] = [];
    const result = await runJsonWorker({
      label: 'test',
      program: process.execPath,
      args: [worker],
      cwd: directory,
      env: workerEnvironment({ assetsRoot: directory, workers: 1, home: directory }),
      onRecord: (record) => records.push(record),
    });
    expect(records).toEqual([{ file: 'one', status: 'ok', priority: Math.min(19, getPriority(0) + 10) }]);
    expect(result.stderr).toContain('worker summary');
  });

  it('lets workers run the card validator through the same node as gm', async () => {
    // The Python workers validate every card with `node`; an nvm-only node is not on the system PATH.
    const directory = tempDir('gm-worker-node-');
    const records: Record<string, unknown>[] = [];
    await runJsonWorker({
      label: 'node lookup',
      program: '/bin/sh',
      args: ['-c', `node -e "console.log(JSON.stringify({ node: process.execPath }))"`],
      cwd: directory,
      env: workerEnvironment({ assetsRoot: directory, workers: 1, home: directory }),
      onRecord: (record) => records.push(record),
    });
    expect(records).toEqual([{ node: process.execPath }]);
  });

  it('terminates malformed and oversized streams', async () => {
    const directory = tempDir('gm-worker-bad-');
    const malformed = join(directory, 'malformed.mjs');
    writeFileSync(malformed, `console.log('{nope'); setInterval(() => {}, 1000);`);
    await expect(
      runJsonWorker({
        label: 'malformed',
        program: process.execPath,
        args: [malformed],
        cwd: directory,
        env: workerEnvironment({ assetsRoot: directory, workers: 1, home: directory }),
        onRecord: () => undefined,
      }),
    ).rejects.toThrow(WorkerError);

    const oversized = join(directory, 'oversized.mjs');
    writeFileSync(oversized, `process.stdout.write('x'.repeat(256)); setInterval(() => {}, 1000);`);
    await expect(
      runJsonWorker({
        label: 'oversized',
        program: process.execPath,
        args: [oversized],
        cwd: directory,
        env: workerEnvironment({ assetsRoot: directory, workers: 1, home: directory }),
        maxLineBytes: 128,
        onRecord: () => undefined,
      }),
    ).rejects.toThrow(/128 bytes/);
  });

  it('names the missing local Python environment instead of spawning without it', async () => {
    const directory = tempDir('gm-worker-missing-');
    const program = join(directory, '.venv/bin/python');
    const onRecord = vi.fn();
    await expect(
      runJsonWorker({
        label: 'audio analysis',
        program,
        args: [],
        cwd: directory,
        env: workerEnvironment({ assetsRoot: directory, workers: 1, home: directory }),
        onRecord,
      }),
    ).rejects.toThrow(`audio analysis: local Python environment is missing: ${program}`);
    expect(onRecord).not.toHaveBeenCalled();
  });
});
