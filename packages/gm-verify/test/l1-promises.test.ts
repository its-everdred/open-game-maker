import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { runL1, runPromiseSpecs } from '../src/gates/l1-smoke.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

describe('L1 promise specs', () => {
  it('passes when no promise specs exist', async () => {
    await expect(runPromiseSpecs(join(FIXTURES, 'sim-ok'))).resolves.toEqual({
      id: 'promises',
      ok: true,
      detail: 'no promise specs',
    });
  });

  it('fails and names a failing promise spec', async () => {
    await expect(runPromiseSpecs(join(FIXTURES, 'promises-bad'))).resolves.toEqual(
      expect.objectContaining({
        id: 'promises',
        ok: false,
        file: 'promises/fail.spec.ts',
      }),
    );
  }, 30_000);

  it('fails closed when the promise directory cannot be scanned', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gm-promises-unreadable-'));
    writeFileSync(join(root, 'promises'), 'not a directory');

    await expect(runPromiseSpecs(root)).resolves.toEqual({
      id: 'promises',
      ok: false,
      detail: 'unavailable: promises directory',
    });
  });

  it('replays generated promise JSON and gives Vitest only a private result map', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gm-promises-generated-'));
    const promises = join(root, 'promises');
    const replayJson = {
      seed: 7,
      keyframe: { tick: 0, state: { alive: true } },
      actions: [{ tick: 11, action: 'crash', phase: 'down' }],
      expectedError: 'TypeError: planted crash',
    };
    const { mkdirSync } = await import('node:fs');
    mkdirSync(promises);
    writeFileSync(
      join(promises, 'abc.spec.ts'),
      "import { promiseTest } from '@gm/sdk/test';\nimport replay from './abc.replay.json';\npromiseTest(replay);\n",
    );
    writeFileSync(join(promises, 'abc.replay.json'), JSON.stringify(replayJson));
    const runReplay = vi.fn(async () => ({
      class: 'reproduces_with_error' as const,
      errorsSeen: ['TypeError: planted crash'],
      finalState: { alive: false },
      finalProbes: { alive: false },
      scriptPath: join(root, 'private', 'replay.json'),
      durationMs: 12,
    }));
    const spawn = vi.fn((_command: string, args: string[]) => {
      const configPath = args[args.indexOf('--config') + 1]!;
      const config = readFileSync(configPath, 'utf8');
      const setupMatch = config.match(/setupFiles: \[([^\]]+)\]/);
      expect(setupMatch).not.toBeNull();
      const setupPath = JSON.parse(setupMatch![1]!) as string;
      expect(readFileSync(setupPath, 'utf8')).toContain('reproduces_with_error');
      expect(readFileSync(setupPath, 'utf8')).not.toContain('keyframe');
      return { status: 0, stdout: '', stderr: '' };
    });

    await expect(runPromiseSpecs(root, { replay: runReplay, spawn, serveDir: 'test-build' })).resolves.toEqual({
      id: 'promises',
      ok: true,
      detail: '1 promise spec(s)',
    });
    expect(runReplay).toHaveBeenCalledWith(
      expect.objectContaining(replayJson),
      expect.objectContaining({ serveDir: join(root, 'test-build') }),
    );
  });

  it('reports a replay failure as a failed gate instead of rejecting L1', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gm-promises-replay-failure-'));
    const promises = join(root, 'promises');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(promises);
    writeFileSync(join(promises, 'abc.spec.ts'), 'export {};\n');
    writeFileSync(
      join(promises, 'abc.replay.json'),
      JSON.stringify({ seed: 7, keyframe: { tick: 0, state: {} }, actions: [] }),
    );

    await expect(
      runPromiseSpecs(root, { replay: vi.fn(async () => Promise.reject(new Error('browser unavailable'))) }),
    ).resolves.toEqual({
      id: 'promises',
      ok: false,
      detail: 'replay failed: browser unavailable',
      file: 'promises/abc.replay.json',
    });
  });

  it('refuses a non-loopback browser target before launch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gm-l1-remote-'));
    const result = await runL1(root, { url: 'https://example.com/', outDir: join(root, 'shots') });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({ id: 'boot', ok: false, detail: 'unavailable: URL is not loopback' });
    expect(result.report).toBeUndefined();
  });

  it('refuses a zero-tick smoke instead of returning a vacuous pass', async () => {
    const result = await runL1(FIXTURES, { ticks: 0 });

    expect(result).toMatchObject({
      gate: 'L1',
      ok: false,
      checks: [{ id: 'ticks', ok: false, detail: 'ticks must be a positive whole number' }],
    });
  });
});
