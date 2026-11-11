import { join } from 'node:path';

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
  l0Options: undefined as unknown,
  l1Options: undefined as unknown,
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

  it('prints failures only as file:line diagnostics and exits one', async () => {
    const result = await gm(['check', 'static']);

    expect(result).toEqual({
      code: 1,
      out: [],
      err: ['src/sim/enemy.ts:12 Math.random in simulation (use sdk rng)'],
    });
    expect(state.l0Options).toEqual({ checks: ['typecheck', 'no-wall-clock-in-sim'] });
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
        deadlineMs: 30_000,
        inputs: [],
        outDir: join(cwd, 'proof'),
        source: 'gm test',
      }),
    );
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
