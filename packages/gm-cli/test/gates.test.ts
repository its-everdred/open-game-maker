import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GateResult } from '@ogm/gm-verify';

import { gm, tempDir } from './helpers.js';

const state = vi.hoisted(() => ({
  l0: {
    gate: 'L0',
    ok: false,
    durationMs: 4,
    checks: [
      {
        id: 'no-wall-clock-in-sim',
        ok: false,
        file: 'src/sim/enemy.ts',
        line: 12,
        detail: 'Math.random in simulation (use sdk rng)',
      },
    ],
  } as GateResult,
  l1: {
    gate: 'L1',
    ok: true,
    durationMs: 20,
    checks: [
      { id: 'boot', ok: true },
      { id: 'ticks', ok: true, detail: 'tick 3600' },
      { id: 'round-trip', ok: true },
      { id: 'hud-still', ok: true },
      { id: 'promises', ok: true },
    ],
    report: '/game/shots/test/report.json',
  } as GateResult,
  bootCode: 0,
  bootStalls: false,
  bootAborted: false,
  bootDeadline: undefined as number | undefined,
  l0Options: undefined as unknown,
  l1Options: undefined as unknown,
}));

vi.mock('../src/commands/check/boot.js', async (original) => ({
  ...(await original<typeof import('../src/commands/check/boot.js')>()),
  checkBoot: async (_ctx: unknown, _dist: unknown, _views: unknown, signal?: AbortSignal, deadlineAt?: number) => {
    state.bootDeadline = deadlineAt;
    if (state.bootStalls)
      await new Promise<void>((resolve) =>
        signal?.addEventListener(
          'abort',
          () => {
            state.bootAborted = true;
            resolve();
          },
          { once: true },
        ),
      );
    return {
      gate: 'L1',
      ok: state.bootCode === 0,
      durationMs: 1,
      checks: [{ id: 'boot', ok: state.bootCode === 0 }],
    };
  },
}));

vi.mock('../src/play-area-check.js', async (original) => ({
  ...(await original<typeof import('../src/play-area-check.js')>()),
  checkPlayArea: async () => ({ ok: true, output: [] }),
}));

vi.mock('@ogm/gm-verify', async (original) => ({
  ...(await original()),
  runL0: (_root: string, options: unknown) => {
    state.l0Options = options;
    return state.l0;
  },
  runL1: async (_root: string, options: unknown) => {
    state.l1Options = options;
    return state.l1;
  },
  readInputScript: () => [],
}));

beforeEach(() => {
  state.bootCode = 0;
  state.bootStalls = false;
  state.bootAborted = false;
  state.bootDeadline = undefined;
  state.l0Options = undefined;
  state.l1Options = undefined;
  state.l0 = {
    gate: 'L0',
    ok: false,
    durationMs: 4,
    checks: [
      {
        id: 'no-wall-clock-in-sim',
        ok: false,
        file: 'src/sim/enemy.ts',
        line: 12,
        detail: 'Math.random in simulation (use sdk rng)',
      },
    ],
  };
  state.l1 = {
    gate: 'L1',
    ok: true,
    durationMs: 20,
    checks: [
      { id: 'boot', ok: true },
      { id: 'ticks', ok: true, detail: 'tick 3600' },
      { id: 'round-trip', ok: true },
      { id: 'hud-still', ok: true },
      { id: 'promises', ok: true },
    ],
    report: '/game/shots/test/report.json',
  };
});

describe('gm check', () => {
  it('runs the complete L0 gate and composes the registered asset check', async () => {
    state.l0 = { gate: 'L0', ok: true, durationMs: 1, checks: [{ id: 'hook-present', ok: true }] };

    expect(await gm(['check'])).toEqual({ code: 0, out: [], err: [] });
    expect(state.l0Options).toBeUndefined();
  }, 60_000);

  it('includes changed look failures and inherited gaps in game reports', async () => {
    state.l0 = { gate: 'L0', ok: true, durationMs: 1, checks: [] };
    const root = tempDir();
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root });
    git('init', '-q');
    writeFileSync(join(root, 'gm.manifest.json'), '{}');
    mkdirSync(join(root, 'shots/a'), { recursive: true });
    mkdirSync(join(root, 'shots/b'), { recursive: true });
    writeFileSync(join(root, 'shots/a/t2.png'), 'a');
    writeFileSync(join(root, 'shots/b/t2.png'), 'b');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(root, 'shots/a/t2.png'), 'changed');
    git('add', '-A');
    git('commit', '-qm', 'change');
    const json = await gm(['check', '--json'], { cwd: root });
    expect(json.code).toBe(1);
    const report = JSON.parse(json.out[0]!);
    expect(report.ok).toBe(false);
    expect(report.look.stills[0].path).toBe('shots/a/t2.png');
    expect(report.look.inherited[0].path).toBe('shots/b/t2.png');
    const text = await gm(['check'], { cwd: root });
    expect(text.code).toBe(1);
    expect(text.err.join('\n')).toContain('inherited:');
    expect(text.err.join('\n')).toContain('shots/a/t2.png');
  }, 60_000);

  it('keeps an unapproved provisional screen visible in gm check until its expiry rung', async () => {
    state.l0 = { gate: 'L0', ok: true, durationMs: 1, checks: [] };
    const root = tempDir();
    const game = join(root, 'games/prototype');
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root });
    git('init', '-q');
    mkdirSync(join(game, 'review'), { recursive: true });
    writeFileSync(join(game, 'gm.manifest.json'), '{}');
    writeFileSync(
      join(game, 'review/decisions.json'),
      JSON.stringify({ screens: { play: { provisional: { owner: 'Kevin', until: 'build' } } } }),
    );
    git('add', '-A');
    git('commit', '-qm', 'provisional scope');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');

    const unspecified = await gm(['check', '--json'], { cwd: game });
    expect(unspecified.code).toBe(2);
    expect(unspecified.err.join('\n')).toContain('a current rung is required');

    const prototype = await gm(['check', '--phase', 'prototype', '--json'], { cwd: game });
    expect(prototype.code, JSON.stringify(prototype)).toBe(0);
    expect(JSON.parse(prototype.out[0]!).look.stills).toContainEqual(
      expect.objectContaining({
        path: 'games/prototype/review/decisions.json',
        status: 'warning',
        detail: expect.stringContaining('approved look target still required'),
      }),
    );
    const plain = await gm(['check', '--phase', 'prototype'], { cwd: game });
    expect(plain.code).toBe(0);
    expect(plain.err.join('\n')).toContain('warning games/prototype/review/decisions.json:');

    const build = await gm(['check', '--phase', 'build', '--json'], { cwd: game });
    expect(build.code).toBe(1);
    expect(JSON.parse(build.out[0]!).look.stills).toContainEqual(
      expect.objectContaining({ status: 'fail', detail: expect.stringContaining('expired at build') }),
    );
  }, 60_000);

  it('fails the complete check when declared loading images are missing', async () => {
    state.l0 = { gate: 'L0', ok: true, durationMs: 1, checks: [] };
    const root = tempDir();
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root });
    git('init', '-q');
    writeFileSync(
      join(root, 'gm.manifest.json'),
      JSON.stringify({ loading: { portrait: 'media/p.png', landscape: 'media/l.png' } }),
    );
    git('add', '-A');
    git('commit', '-qm', 'fixture');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const result = await gm(['check', '--json'], { cwd: root });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out[0]!).loadingErrors).toHaveLength(2);
  }, 60_000);

  it('prints failures only as file:line diagnostics and exits one', async () => {
    const result = await gm(['check', 'static']);

    expect(result).toEqual({
      code: 1,
      out: [],
      err: ['src/sim/enemy.ts:12 Math.random in simulation (use sdk rng)'],
    });
    expect(state.l0Options).toEqual({ checks: ['typecheck', 'no-wall-clock-in-sim', 'image-stretch'] });
  });

  it('returns the GateResult unchanged with --json', async () => {
    const result = await gm(['check', 'static', '--json']);

    expect(result.code).toBe(1);
    expect(result.err).toEqual([]);
    expect(JSON.parse(result.out[0]!)).toEqual(state.l0);
  });

  it('runs the hook-only selection', async () => {
    state.l0 = { gate: 'L0', ok: true, durationMs: 1, checks: [{ id: 'hook-present', ok: true }] };

    expect(await gm(['check', 'hooks'])).toEqual({ code: 0, out: [], err: [] });
    expect(state.l0Options).toEqual({ checks: ['hook-present'] });
  });
});

describe('gm test', () => {
  it('stops when the boot gate fails', async () => {
    state.bootCode = 1;
    const result = await gm(['test']);
    expect(result.code).toBe(1);
    expect(state.l1Options).toBeUndefined();
    const json = await gm(['test', '--json']);
    expect(JSON.parse(json.out[0]!)).toMatchObject({ gate: 'L1', ok: false, checks: [{ id: 'boot', ok: false }] });
  });
  it('applies the overall deadline while boot is stalled', async () => {
    state.bootStalls = true;
    const result = await gm(['test', '--deadline', '1']);
    expect(result.code).toBe(1);
    expect(result.err.join(' ')).toContain('overall deadline exceeded during boot');
    expect(state.bootAborted).toBe(true);
    expect(state.bootDeadline).toEqual(expect.any(Number));
    expect(state.l1Options).toBeUndefined();
  });

  it('passes ticks, inputs and output through to L1 and prints the report path', async () => {
    const cwd = tempDir();
    const result = await gm(
      ['test', '--ticks', '3600', '--deadline', '30', '--inputs', 'script.json', '--out', 'proof'],
      { cwd },
    );

    expect(result).toEqual({ code: 0, out: ['/game/shots/test/report.json  L1 pass'], err: [] });
    expect(state.l1Options).toEqual(
      expect.objectContaining({
        ticks: 3_600,
        inputs: [],
        outDir: join(cwd, 'proof'),
        source: 'gm test',
      }),
    );
    expect((state.l1Options as { deadlineMs: number }).deadlineMs).toBeGreaterThan(0);
    expect((state.l1Options as { deadlineMs: number }).deadlineMs).toBeLessThanOrEqual(30_000);
  });

  it('only invokes a backstop supplied by the executable', async () => {
    const backstop = vi.fn();
    await gm(['test'], { onTestTimeout: backstop });
    const options = state.l1Options as { onTimeout: (reason: string) => void };
    options.onTimeout('stalled at tick 0');
    expect(backstop).toHaveBeenCalledOnce();
  });

  it('rejects a non-positive deadline', async () => {
    const result = await gm(['test', '--deadline', '0']);
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('--deadline must be a positive number');
  });

  it('prints failed checks, exits one, and supports JSON', async () => {
    state.l1 = {
      gate: 'L1',
      ok: false,
      durationMs: 10,
      checks: [{ id: 'round-trip', ok: false, detail: 'unavailable: __gm.restore' }],
    };

    const text = await gm(['test']);
    expect(text).toEqual({ code: 1, out: [], err: ['round-trip unavailable: __gm.restore'] });
    const json = await gm(['test', '--json']);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out[0]!)).toEqual(state.l1);
  });

  it('refuses zero ticks before launching the gate', async () => {
    const result = await gm(['test', '--ticks', '0']);

    expect(result.code).toBe(2);
    expect(result.err[0]).toMatch(/--ticks must be at least 1/);
  });
});
