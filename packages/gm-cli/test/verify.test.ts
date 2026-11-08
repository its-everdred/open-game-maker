import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { GmContext } from '../src/command.js';
import { command as perfCommand } from '../src/commands/perf/index.js';
import { appFrame, finish, parseRecord } from '../src/commands/run/index.js';
import type { VerifyReport } from '@ogm/gm-verify';
import { gm, tempDir } from './helpers.js';

const perfState = vi.hoisted(() => ({ events: [] as string[], budgetError: false }));

vi.mock('@ogm/gm-verify', () => ({
  acquireSlot: async () => {
    perfState.events.push('acquire');
    return { release: () => perfState.events.push('release') };
  },
  launch: async () => {
    perfState.events.push('launch');
    return { close: async () => perfState.events.push('close') };
  },
  measureLoad: async () => {
    perfState.events.push('measure');
    return {
      device: 'iPhone 13',
      cpu: 4,
      firstMs: 10,
      cachedMs: 5,
      fromNetwork: 1,
      fromCache: 0,
      bytesByType: { code: { n: 1, bytes: 100 } },
    };
  },
  totalBytes: () => 100,
  measureBudgets: () => ({
    downloadBytes: [100, 1000, 'ok'],
    drawCalls: [0, 1000, 'unknown'],
    triangles: [0, 1000, 'unknown'],
    textureBytes: [0, 1000, 'unknown'],
  }),
  readBudgetOverrides: () => {
    if (perfState.budgetError) throw new Error('invalid calibration');
    return {};
  },
  readInputScript: () => [],
}));

const unknownBudgets = (): VerifyReport['budgets'] => ({
  downloadBytes: [0, 0, 'unknown'],
  drawCalls: [0, 0, 'unknown'],
  triangles: [0, 0, 'unknown'],
  textureBytes: [0, 0, 'unknown'],
});

describe('gm run', () => {
  it('parses opt-in 60 fps native recording without changing the defaults', () => {
    expect(parseRecord('4s', undefined, false)).toEqual({ seconds: 4 });
    expect(parseRecord('4s', 60, true)).toEqual({ seconds: 4, fps: 60, native: true });
  });

  it('rejects recording fidelity flags without a clip and invalid frame rates', () => {
    expect(() => parseRecord(undefined, 60, false)).toThrow(/--record-fps requires --record/);
    expect(() => parseRecord(undefined, undefined, true)).toThrow(/--record-native requires --record/);
    expect(() => parseRecord('4s', 0, false)).toThrow(/--record-fps must be an integer from 1 to 60/);
    expect(() => parseRecord('4s', 61, false)).toThrow(/--record-fps must be an integer from 1 to 60/);
    expect(() => parseRecord('4s', 29.97, false)).toThrow(/--record-fps must be an integer from 1 to 60/);
  });

  it('wires the recording fidelity flags from argv before launching a browser', async () => {
    const orphan = await gm(['run', '--record-native']);
    expect(orphan.code).toBe(2);
    expect(orphan.err.join('\n')).toMatch(/--record-native requires --record/);

    const tooFast = await gm(['run', '--record', '4s', '--record-fps', '61']);
    expect(tooFast.code).toBe(2);
    expect(tooFast.err.join('\n')).toMatch(/--record-fps must be an integer from 1 to 60/);
  });

  it('refuses a non-loopback URL before launching a browser', async () => {
    const result = await gm(['run', '--url', 'http://0.0.0.0:8000/']);
    expect(result.code).toBe(2);
    expect(result.err).toEqual([expect.stringMatching(/loopback only.*Try:/)]);
  });

  it('refuses malformed frame and timeline lists before launching a browser', async () => {
    expect((await gm(['run', '--frames', '0,nope'])).err[0]).toMatch(/--frames/);
    expect((await gm(['run', '--frames', '0,,2'])).err[0]).toMatch(/--frames/);
    expect((await gm(['run', '--timeline', '0:10:0'])).err[0]).toMatch(/--timeline/);
    expect((await gm(['run', '--timeline', '0::1'])).err[0]).toMatch(/--timeline/);
  });

  it('turns a queued ffmpeg refusal into the install-hint usage error', () => {
    const now = new Date().toISOString();
    const report: VerifyReport = {
      runId: 'queued',
      renderer: 'unknown',
      software: false,
      viewport: 'phone',
      tier: 'mobile',
      frames: [],
      console: [],
      budgets: unknownBudgets(),
      probes: {},
      clients: 1,
      seats: [],
      unchecked: ['iPhone Safari', 'sound'],
      verdict: 'error',
      error: 'ffmpeg not found on PATH',
      startedAt: now,
      endedAt: now,
      gmVerifyVersion: 'test',
    };
    const ctx = { cwd: '/', json: false, out: () => {}, err: () => {} } as GmContext;
    expect(() => finish(ctx, report, '/shots/report.json')).toThrow(/sudo apt install ffmpeg/);
  });

  it('refuses an invalid calibration file before launching a browser', async () => {
    perfState.budgetError = true;
    try {
      const result = await gm(['run', '--budgets', 'budgets.json']);
      expect(result.code).toBe(2);
      expect(result.err[0]).toMatch(/--budgets could not be read/);
    } finally {
      perfState.budgetError = false;
    }
  });
});

describe('gm run in the app shell', () => {
  // A game folder and a host home: api.env names the app, ~/.config/ogm/qa holds the QA account's storage state.
  function host(options: { storage?: boolean; origin?: string } = {}) {
    const home = tempDir();
    const game = tempDir();
    mkdirSync(join(home, '.config/ogm/env'), { recursive: true });
    mkdirSync(join(home, '.config/ogm/qa'), { recursive: true });
    writeFileSync(
      join(home, '.config/ogm/env/api.env'),
      `OGM_APP_ORIGIN=${options.origin ?? 'https://app.example/'}\n`,
    );
    if (options.storage !== false) writeFileSync(join(home, '.config/ogm/qa/storage.json'), '{}');
    writeFileSync(join(game, 'gm.manifest.json'), '{"id":"blobs"}');
    const ctx = { cwd: game, home, env: {} } as unknown as GmContext;
    return { home, game, ctx };
  }

  it('opens the game the way a player does, at /play/<id> on the host app, signed in as the QA account', () => {
    const { home, ctx } = host();
    expect(appFrame(ctx, {})).toEqual({
      url: 'https://app.example/play/blobs',
      storageState: join(home, '.config/ogm/qa/storage.json'),
    });
    expect(appFrame(ctx, { app: 'http://127.0.0.1:5173/play/blobs' }).url).toBe('http://127.0.0.1:5173/play/blobs');
  });

  it('refuses to capture without a signed-in state, naming the host command that mints one', () => {
    const { ctx } = host({ storage: false });
    expect(() => appFrame(ctx, {})).toThrow(/no signed-in storage state.*ogm-qa-signin/);
  });

  it('defaults to the app shell, so a run without a signed-in state fails instead of capturing the bare game', async () => {
    const home = tempDir();
    const result = await gm(['run'], { home });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(/no app origin|no signed-in storage state/);
    const queued = await gm(['run'], { home, env: { GM_VERIFY_QUEUE: '1' } });
    expect(queued.err.join('\n')).toMatch(/--frame bare/);
  });
});

describe('gm shot', () => {
  it('refuses a sheet directory with no still frames', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'phone'));
    const result = await gm(['shot', '--sheet', dir]);
    expect(result.code).toBe(2);
    expect(result.err).toEqual([expect.stringMatching(/no t\*\.png stills.*Try:/)]);
  });
});

describe('gm perf', () => {
  it('refuses non-loopback URLs and a zero CPU throttle before launching a browser', async () => {
    expect((await gm(['perf', '--url', 'https://example.com/'])).err[0]).toMatch(/loopback only/);
    expect((await gm(['perf', '--cpu', '0'])).err[0]).toMatch(/--cpu must be at least 1/);
  });

  it('holds a host slot from before launch until after browser close', async () => {
    perfState.events.length = 0;
    const ctx = {
      cwd: process.cwd(),
      config: { verifySoftwareGl: false, verifyQueue: false },
      json: false,
      out: () => {},
      err: () => {},
    } as GmContext;
    const code = await perfCommand.run(ctx, [], {
      url: 'http://127.0.0.1:8000/',
      device: 'iphone13',
      cpu: 4,
      tier: 'mobile',
    });
    expect(code).toBe(0);
    expect(perfState.events).toEqual(['acquire', 'launch', 'measure', 'close', 'release']);
  });
});

describe('gm verify serve', () => {
  it('refuses a poll interval that would spin the host runner', async () => {
    const cwd = tempDir();
    const result = await gm(['verify', 'serve', '--workspaces', '.', '--once', '--poll', '0'], { cwd });
    expect(result.code).toBe(2);
    expect(result.err[0]).toMatch(/--poll must be at least 100 milliseconds/);
  });
});
