import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runL1, type RunL1Options } from '../src/gates/l1-smoke.js';
import { serveStatic } from '../src/server.js';
import { acquireSlot } from '../src/semaphore.js';

const STUB = fileURLToPath(new URL('../fixtures/stub-game/', import.meta.url));
const SOFTWARE = process.env.GM_VERIFY_SOFTWARE_GL === '1';

let server: Awaited<ReturnType<typeof serveStatic>>;
beforeAll(async () => {
  server = await serveStatic(STUB);
});
afterAll(async () => {
  await server.close();
});

function out(): string {
  return mkdtempSync(join(tmpdir(), 'gm-l1-'));
}

function run(url = server.url, options: Partial<RunL1Options> = {}) {
  const root = out();
  return runL1(STUB, {
    url,
    outDir: join(root, 'shots'),
    ticks: 3_600,
    software: SOFTWARE,
    slots: { runtimeDir: join(root, 'slots') },
    readyTimeoutMs: 20_000,
    ...options,
  });
}

describe('L1 deterministic browser smoke', () => {
  it('boots, advances 3,600 ticks, restores identical state and writes a non-blank HUD still', async () => {
    const eventsFile = join(out(), 'events.jsonl');
    const result = await run(server.url, {
      eventsFile,
      inputs: [{ t: 1, action: 'jump', phase: 'down', playerIndex: 0 }],
    });

    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'boot', ok: true }),
        expect.objectContaining({ id: 'ticks', ok: true, detail: 'tick 3600' }),
        expect.objectContaining({ id: 'round-trip', ok: true }),
        expect.objectContaining({ id: 'hud-still', ok: true }),
        expect.objectContaining({ id: 'promises', ok: true }),
      ]),
    );
    expect(result.report && existsSync(result.report)).toBe(true);
    const report = JSON.parse(readFileSync(result.report!, 'utf8')) as {
      probes: { tick?: number; lastAction?: string };
    };
    expect(report.probes.tick).toBe(3_600);
    expect(report.probes.lastAction).toBe('jump');
    expect(
      readFileSync(eventsFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([
      expect.objectContaining({ activity: 'playtesting', phase: 'start', source: 'gm test' }),
      expect.objectContaining({ activity: 'playtesting', phase: 'end', source: 'gm test' }),
    ]);
  });

  it('watchdog stops a stalled page within 100 seconds and releases its slot', async () => {
    const root = out();
    const runtimeDir = join(root, 'slots');
    const result = await runL1(STUB, {
      url: `${server.url}?stall=1`,
      outDir: join(root, 'shots'),
      ticks: 60,
      software: SOFTWARE,
      slots: { runtimeDir, slots: 1 },
      deadlineMs: 20_000,
      stallTimeoutMs: 500,
    });
    expect(result.ok).toBe(false);
    expect(result.checks.some((check) => check.detail?.includes('no tick progress for 0.5 seconds'))).toBe(true);
    expect(existsSync(join(root, 'shots', 'stall.json'))).toBe(true);
    const slot = await acquireSlot({ runtimeDir, slots: 1, waitMs: 2_000 });
    slot.release();
  }, 25_000);

  it.each(['SIGTERM', 'SIGINT'] as const)(
    'releases the slot when a running test receives %s',
    async (signal) => {
      const root = out();
      const runtimeDir = join(root, 'slots');
      const moduleUrl = new URL('../dist/gates/l1-smoke.js', import.meta.url).href;
      const script = `import { runL1 } from ${JSON.stringify(moduleUrl)};
      const result = await runL1(${JSON.stringify(STUB)}, {
        url: ${JSON.stringify(`${server.url}?stall=1`)}, outDir: ${JSON.stringify(join(root, 'shots'))},
        ticks: 60, software: true, slots: { runtimeDir: ${JSON.stringify(runtimeDir)}, slots: 1 },
        progress: (line) => { if (line.includes('(slot acquired)')) console.log('ready'); }
      });
      process.exitCode = result.ok ? 0 : 1;`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const exited = once(child, 'exit');
      try {
        const [ready] = await once(child.stdout, 'data');
        expect(String(ready)).toContain('ready');
        child.kill(signal);
        const [code, exitSignal] = await exited;
        expect(code).toBe(1);
        expect(exitSignal).toBeNull();
        const slot = await acquireSlot({ runtimeDir, slots: 1, waitMs: 2_000 });
        slot.release();
      } finally {
        child.kill('SIGKILL');
      }
    },
    30_000,
  );

  it('fails the HUD check when the captured canvas is blank', async () => {
    const result = await run(`${server.url}?blank=1`);

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'hud-still', ok: false }));
  });

  it('reports the thrown tick and continues to produce a gate result', async () => {
    const result = await run(`${server.url}?throwAt=100`);

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'ticks', ok: false, detail: expect.stringContaining('stub threw on tick 100') }),
    );
  });

  it('fails boot when the page logs a console error', async () => {
    const result = await run(`${server.url}?noisy=1`);

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'boot', ok: false, detail: expect.stringContaining('stub noise') }),
    );
  });

  it('names the unavailable restore hook without skipping the other checks', async () => {
    const result = await run(`${server.url}?noRestore=1`);

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      id: 'round-trip',
      ok: false,
      detail: 'unavailable: __gm.restore',
    });
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'hud-still', ok: true }));
  });
});
