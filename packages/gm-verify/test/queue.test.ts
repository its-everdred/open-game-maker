import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  processRequest,
  requestDir,
  serveQueue,
  submitRequest,
  waitForReport,
  type Runner,
  type VerifyRequest,
} from '../src/queue.js';
import { ALWAYS_UNCHECKED, unknownBudgets, writeReport } from '../src/report.js';
import type { RunVerifyOptions } from '../src/run.js';

function workspaces(): { root: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), 'gm-queue-'));
  const workspace = join(root, 'ws1');
  mkdirSync(join(workspace, 'dist'), { recursive: true });
  writeFileSync(join(workspace, 'dist', 'index.html'), '<p>game</p>');
  return { root, workspace };
}

const request = (over: Partial<VerifyRequest> = {}): VerifyRequest => ({
  v: 1,
  runId: 'run1',
  serveDir: 'dist',
  args: { viewport: 'phone', tier: 'mobile', frames: [0] },
  ...over,
});

/** Stands in for the browser run: fetches what the host served and writes a passing report. */
const fakeRunner =
  (seen: RunVerifyOptions[]): Runner =>
  async (options) => {
    seen.push(options);
    const body = await (await fetch(options.url)).text();
    const now = new Date().toISOString();
    const report = {
      runId: options.runId ?? 'x',
      renderer: 'fake',
      software: false,
      viewport: options.viewport,
      tier: options.tier,
      frames: [],
      console: [],
      budgets: unknownBudgets(),
      probes: { served: body },
      clients: 1,
      unchecked: [...ALWAYS_UNCHECKED],
      verdict: 'pass' as const,
      startedAt: now,
      endedAt: now,
      gmVerifyVersion: 'test',
    };
    writeReport(options.outDir, report);
    return { report };
  };

describe('verify queue', () => {
  it('round-trips a sandbox request file to a report file written by the host', async () => {
    const { root, workspace } = workspaces();
    const dir = submitRequest(
      workspace,
      request({
        aiurIssue: 45,
        aiurRunId: 'aiur/45',
        args: { viewport: 'phone', tier: 'mobile', frames: [0], record: { seconds: 4, fps: 60, native: true } },
      }),
    );
    const seen: RunVerifyOptions[] = [];
    const waiting = waitForReport(dir, { pollMs: 20, timeoutMs: 5_000 });
    await serveQueue(root, { runner: fakeRunner(seen), software: true, once: true });
    const report = await waiting;
    expect(report.verdict).toBe('pass');
    expect(report.probes.served).toBe('<p>game</p>');
    expect(seen[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(seen[0].outDir).not.toBe(dir);
    expect(existsSync(join(dir, 'summary.txt'))).toBe(true);
    expect(seen[0].frames).toEqual([0]);
    expect(seen[0].record).toEqual({ seconds: 4, fps: 60, native: true });
    expect(seen[0].aiurIssue).toBe(45);
    expect(seen[0].aiurRunId).toBe('aiur/45');
  });

  it('runs a boot request on the host and publishes its result', async () => {
    const { workspace } = workspaces();
    const dir = submitRequest(workspace, request({ args: { viewport: 'both', tier: 'mobile', boot: true } }));
    const bootRunner = vi.fn(
      async (options: Parameters<NonNullable<import('../src/queue.js').ProcessOptions['bootRunner']>>[0]) => {
        writeFileSync(join(options.outDir, 'phone.png'), 'screenshot');
        return {
          gate: 'L1' as const,
          ok: false,
          durationMs: 1,
          checks: [{ id: 'boot' as const, ok: false, detail: 'blank frame' }],
        };
      },
    );
    const report = await processRequest(workspace, dir, { runner: fakeRunner([]), bootRunner, software: true });
    expect(report.verdict).toBe('fail');
    expect(report.error).toContain('blank frame');
    expect(bootRunner.mock.calls[0]![0].viewports).toEqual(['phone', 'tablet-landscape']);
    expect(existsSync(join(dir, 'phone.png'))).toBe(true);
    expect((await waitForReport(dir)).verdict).toBe('fail');
  });

  it('does not start a boot request whose caller deadline already expired', async () => {
    const { workspace } = workspaces();
    const dir = submitRequest(
      workspace,
      request({ deadlineAt: Date.now() - 1, args: { viewport: 'phone', tier: 'mobile', boot: true } }),
    );
    const bootRunner = vi.fn();
    const report = await processRequest(workspace, dir, { runner: fakeRunner([]), bootRunner, software: true });
    expect(report.verdict).toBe('error');
    expect(report.error).toContain('deadline exceeded before capture');
    expect(bootRunner).not.toHaveBeenCalled();
  });

  it('cancels a boot request when the host deadline expires', async () => {
    const { workspace } = workspaces();
    const dir = submitRequest(
      workspace,
      request({ deadlineAt: Date.now() + 1_000, args: { viewport: 'phone', tier: 'mobile', boot: true } }),
    );
    let aborted = false;
    const bootRunner: NonNullable<import('../src/queue.js').ProcessOptions['bootRunner']> = async (options) => {
      options.signal!.addEventListener(
        'abort',
        () => {
          aborted = true;
        },
        { once: true },
      );
      return new Promise(() => {});
    };
    const report = await processRequest(workspace, dir, {
      runner: fakeRunner([]),
      bootRunner,
      software: true,
      timeoutMs: 10_000,
    });
    expect(report.verdict).toBe('fail');
    expect(report.error).toContain('deadline');
    expect(aborted).toBe(true);
  });

  it('claims each request once, so a second pass does not run it again', async () => {
    const { root, workspace } = workspaces();
    submitRequest(workspace, request({ runId: 'once' }));
    const seen: RunVerifyOptions[] = [];
    await serveQueue(root, { runner: fakeRunner(seen), software: true, once: true });
    await serveQueue(root, { runner: fakeRunner(seen), software: true, once: true });
    expect(seen).toHaveLength(1);
  });

  it('reaps a claim whose runner PID is dead', async () => {
    const { root, workspace } = workspaces();
    const dir = submitRequest(workspace, request({ runId: 'recovered' }));
    mkdirSync(join(dir, 'claim'));
    writeFileSync(join(dir, 'claim', 'pid'), '2147483647\n');
    const seen: RunVerifyOptions[] = [];
    await serveQueue(root, { runner: fakeRunner(seen), software: true, once: true });
    expect(seen).toHaveLength(1);
  });

  it('rejects an oversized timeline before the host runner can allocate it', async () => {
    const { workspace } = workspaces();
    const dir = requestDir(workspace, 'huge');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'request.json'),
      JSON.stringify(
        request({
          runId: 'huge',
          args: { viewport: 'phone', tier: 'mobile', timeline: { from: 0, to: 1, step: 0.000001 } },
        }),
      ),
    );
    const seen: RunVerifyOptions[] = [];
    const report = await processRequest(workspace, dir, { runner: fakeRunner(seen), software: false });
    expect(seen).toHaveLength(0);
    expect(report.error).toMatch(/invalid request/);
  });

  it('refuses a serveDir outside the workspace and still writes an error report', async () => {
    const { workspace } = workspaces();
    const dir = submitRequest(workspace, request({ serveDir: '../..' }));
    const seen: RunVerifyOptions[] = [];
    const report = await processRequest(workspace, dir, { runner: fakeRunner(seen), software: false });
    expect(seen).toHaveLength(0);
    expect(report.verdict).toBe('error');
    expect(report.error).toMatch(/not a directory inside the workspace/);
    expect((await waitForReport(dir, { timeoutMs: 100 })).verdict).toBe('error');
  });

  it('refuses a serveDir that symlinks out of the workspace', async () => {
    const { workspace } = workspaces();
    symlinkSync(tmpdir(), join(workspace, 'escape'));
    const dir = submitRequest(workspace, request({ serveDir: 'escape' }));
    const report = await processRequest(workspace, dir, { runner: fakeRunner([]), software: false });
    expect(report.error).toMatch(/not a directory inside the workspace/);
  });

  it('rejects a request carrying a URL or unknown fields: the host runs nothing the request names', async () => {
    const { workspace } = workspaces();
    const dir = requestDir(workspace, 'evil');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'request.json'),
      JSON.stringify({
        ...request({ runId: 'evil' }),
        url: 'http://example.com/',
        args: { viewport: 'phone', tier: 'mobile', cmd: 'rm' },
      }),
    );
    const seen: RunVerifyOptions[] = [];
    const report = await processRequest(workspace, dir, { runner: fakeRunner(seen), software: false });
    expect(seen).toHaveLength(0);
    expect(report.verdict).toBe('error');
    expect(report.error).toMatch(/invalid request/);
  });

  it('refuses a request directory that is a symlink out of the workspace and writes nothing there', async () => {
    const { workspace } = workspaces();
    const outside = mkdtempSync(join(tmpdir(), 'gm-outside-'));
    writeFileSync(join(outside, 'request.json'), JSON.stringify(request({ runId: 'link' })));
    mkdirSync(join(workspace, '.gm', 'verify'), { recursive: true });
    symlinkSync(outside, requestDir(workspace, 'link'));
    await expect(
      processRequest(workspace, requestDir(workspace, 'link'), { runner: fakeRunner([]), software: false }),
    ).rejects.toThrow(/not a real directory/);
    expect(existsSync(join(outside, 'report.json'))).toBe(false);
  });

  it('never writes through a symlink the sandbox plants in its request directory during the run', async () => {
    const { workspace } = workspaces();
    const victim = join(mkdtempSync(join(tmpdir(), 'gm-victim-')), 'precious.txt');
    writeFileSync(victim, 'keep me');
    const dir = submitRequest(workspace, request({ runId: 'swap' }));
    const planting: Runner = async (options) => {
      symlinkSync(victim, join(dir, 'summary.txt'));
      return fakeRunner([])(options);
    };
    await expect(processRequest(workspace, dir, { runner: planting, software: false })).rejects.toThrow(/EEXIST/);
    expect(readFileSync(victim, 'utf8')).toBe('keep me');
  });

  it('answers a refused request with an error report and does not run it again', async () => {
    const { root, workspace } = workspaces();
    const dir = submitRequest(workspace, request({ runId: 'planted' }));
    writeFileSync(join(dir, 'stray.png'), '');
    const seen: RunVerifyOptions[] = [];
    await serveQueue(root, { runner: fakeRunner(seen), software: false, once: true });
    await serveQueue(root, { runner: fakeRunner(seen), software: false, once: true });
    expect(seen).toHaveLength(0);
    const report = await waitForReport(dir, { timeoutMs: 100 });
    expect(report.verdict).toBe('error');
    expect(report.error).toMatch(/already holds files other than request\.json/);
  });

  it('refuses a request.json that is a FIFO instead of blocking the host on it', async () => {
    const { workspace } = workspaces();
    const dir = requestDir(workspace, 'fifo');
    mkdirSync(dir, { recursive: true });
    execFileSync('mkfifo', [join(dir, 'request.json')]);
    const report = await processRequest(workspace, dir, { runner: fakeRunner([]), software: false });
    expect(report.error).toMatch(/regular file/);
  });

  it('does not create a claim through a symlinked request during queue scans', async () => {
    const { root, workspace } = workspaces();
    const outside = mkdtempSync(join(tmpdir(), 'gm-outside-'));
    writeFileSync(join(outside, 'request.json'), JSON.stringify(request({ runId: 'link' })));
    mkdirSync(join(workspace, '.gm', 'verify'), { recursive: true });
    symlinkSync(outside, requestDir(workspace, 'link'));
    await serveQueue(root, { runner: fakeRunner([]), software: false, once: true });
    expect(existsSync(join(outside, 'claim'))).toBe(false);
  });
});
