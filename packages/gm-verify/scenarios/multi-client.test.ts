import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { HarnessSnapshot } from './multi-client/harness.ts';
import {
  avatarX,
  bandsFor,
  gamesServer,
  hasAvatars,
  judgeSeat,
  LIMITS,
  MULTI_UNCHECKED,
  NOT_PLAYED,
  playError,
  profileFor,
  runMultiClient,
  toSeatMetrics,
  type LinkProfileName,
} from './multi-client.ts';
import { NO_FORFEIT } from './multi-client/run-options.ts';
import { verifyReportSchema } from '../src/report.js';
import { BAD_LINK, CLEAN_LINK } from '../src/link/schedule.js';

/* The full run needs a built rooms service and Chromium; CI runs only the pure tests below. */
// eslint-disable-next-line no-restricted-properties -- opt-in switch for a host-only scenario, not configuration
const enabled = process.env.OGM_SCENARIOS === '1';
// eslint-disable-next-line no-restricted-properties -- same opt-in, see above
const softwareGl = process.env.GM_VERIFY_SOFTWARE_GL === '1';
const TEMPLATE = fileURLToPath(new URL('../../../templates/game-multiplayer/', import.meta.url));

function sample(overrides: Partial<HarnessSnapshot> = {}): HarnessSnapshot {
  return {
    seat: 0,
    mode: 'per-seat',
    epoch: 'e1',
    tick: 120,
    buildId: 'b1',
    rulesetHash: 'r1',
    rttMs: 80,
    jitterMs: 20,
    lossPct: 2,
    clockOffsetMs: 8,
    lateStartTicks: 0,
    inputDelayTicks: 3,
    inputGaps: 0,
    localResponseMs: 16,
    remoteUpdateMs: 90,
    eventDelayMs: 120,
    desyncs: 0,
    recoveries: 0,
    hardResyncs: 0,
    droppedBytes: 0,
    oversized: 0,
    at: 0,
    ...overrides,
  };
}

describe('the multi-client bands and verdict', () => {
  it('writes the impairment into the bad profile bound and leaves the clean one at the relay budget', () => {
    /* 3 input-delay ticks at 60 Hz (50 ms) plus one 20 Hz snapshot interval (50 ms) of simulation on top of the path. */
    expect(bandsFor(CLEAN_LINK)).toMatchObject({
      localResponseMs: 17,
      remoteUpdateP95Ms: 250,
      eventDelayP95Ms: 188,
      inputGaps: 1,
      needsRecovery: false,
    });
    /* latencyMs 40 + 2 × jitter 20 = 80 ms of headroom, and this profile schedules a disconnect. */
    expect(bandsFor(BAD_LINK)).toMatchObject({
      remoteUpdateP95Ms: 413,
      eventDelayP95Ms: 288,
      inputGaps: 2,
      needsRecovery: true,
    });
  });

  it('names every seat that misses a band', () => {
    const bands = bandsFor(BAD_LINK);
    const failing = toSeatMetrics(2, [
      sample({
        seat: 2,
        localResponseMs: 40,
        remoteUpdateMs: 400,
        eventDelayMs: 500,
        inputGaps: 5,
        desyncs: 1,
        hardResyncs: 2,
        oversized: 3,
        recoveries: 0,
      }),
    ]);

    expect(judgeSeat(failing, bands)).toEqual([
      'seat 2 localResponseMs 40 > 17',
      'seat 2 eventDelayP95Ms 500 > 288',
      'seat 2 inputGaps 5 > 2',
      'seat 2 desyncs 1 > 0',
      'seat 2 hardResyncs 2 > 0',
      'seat 2 oversized 3 > 0',
      'seat 2 recoveries 0 < 1 after its 3 s drop',
    ]);
  });

  it('passes a seat inside its band', () => {
    expect(judgeSeat(toSeatMetrics(0, [sample()]), bandsFor(BAD_LINK))).toEqual([]);
  });

  it('leaves the latency bands to a hardware renderer and still judges the rest of the seat', () => {
    const seat = toSeatMetrics(2, [
      sample({ seat: 2, remoteUpdateMs: 900, eventDelayMs: 900, inputGaps: 5, recoveries: 2 }),
    ]);

    expect(judgeSeat(seat, bandsFor(BAD_LINK))).toEqual([
      'seat 2 remoteUpdateP95Ms 900 > 413',
      'seat 2 eventDelayP95Ms 900 > 288',
      'seat 2 inputGaps 5 > 2',
    ]);
    expect(judgeSeat(seat, bandsFor(BAD_LINK), { latency: false })).toEqual(['seat 2 inputGaps 5 > 2']);
  });
});

describe('folding samples into a seat entry', () => {
  it('keeps the latest gauges and takes the nearest-rank p95 of the two delays', () => {
    const delays = Array.from({ length: 100 }, (_, index) => index + 1);
    const seat = toSeatMetrics(1, [
      ...delays.map((delay) => sample({ seat: 1, remoteUpdateMs: delay, eventDelayMs: delay })),
      sample({ seat: 1, tick: 999, remoteUpdateMs: 400, eventDelayMs: 400, recoveries: 2 }),
    ]);

    expect(seat.seat).toBe(1);
    expect(seat.tick).toBe(999);
    /* ceil(0.95 × 101) = 96 → the 400 lands last, so the p95 is the 96th smallest sample. */
    expect(seat.remoteUpdateP95Ms).toBe(96);
    expect(seat.eventDelayP95Ms).toBe(96);
    expect(seat.recoveries).toBe(2);
    expect(seat.buildId).toBe('b1');
    expect(seat.rulesetHash).toBe('r1');
  });

  it('omits an epoch and a ruleset hash it never had instead of writing an empty string', () => {
    const seat = toSeatMetrics(0, [sample({ epoch: '', rulesetHash: undefined })]);

    expect(seat.epoch).toBeUndefined();
    expect(seat.rulesetHash).toBeUndefined();
  });
});

describe('profileFor', () => {
  it('reads the two named profiles and passes an explicit profile through', () => {
    expect(profileFor('clean')).toEqual(CLEAN_LINK);
    expect(profileFor('bad')).toEqual(BAD_LINK);
    expect(profileFor(BAD_LINK)).toEqual(BAD_LINK);
    expect(profileFor(undefined)).toEqual(BAD_LINK);
    expect(() => profileFor('terrible' as LinkProfileName)).toThrow(/unknown link profile/);
  });

  it('replays the link object a report carries', () => {
    const report = JSON.parse(readFileSync(REPLAY_FIXTURE, 'utf8')) as { link: typeof BAD_LINK };

    expect(profileFor(report.link)).toEqual(report.link);
  });
});

const REPLAY_FIXTURE = fileURLToPath(new URL('../fixtures/link/seed-1234.json', import.meta.url));

describe('the scenario games server', () => {
  /* What `vite build` leaves for a game whose assets were built: `public/assets` and `public/a` copied into dist. */
  async function serveBuild(): Promise<{
    get: (path: string) => Promise<number>;
    raw: (path: string) => Promise<number>;
    close: () => Promise<void>;
  }> {
    const root = mkdtempSync(join(tmpdir(), 'gm-games-server-'));
    const dist = join(root, 'dist');
    mkdirSync(dist);
    writeFileSync(join(root, 'outside.txt'), 'not part of the build');
    mkdirSync(join(dist, 'assets'));
    mkdirSync(join(dist, 'a'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    writeFileSync(join(dist, 'assets', 'manifest.json'), '{}');
    writeFileSync(join(dist, 'assets', 'index-abc.js'), '');
    writeFileSync(join(dist, 'a', 'mossbeard.0f1e2d.glb'), 'glb');
    const server = gamesServer(dist);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    return {
      get: async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).status,
      /* fetch normalises `..` away; a raw request puts it on the wire as written. */
      raw: (path) =>
        new Promise((done, fail) => {
          request({ host: '127.0.0.1', port, path }, (response) => {
            response.resume();
            done(response.statusCode ?? 0);
          })
            .on('error', fail)
            .end();
        }),
      close: async () => {
        await new Promise((done) => server.close(done));
        rmSync(root, { recursive: true, force: true });
      },
    };
  }

  it('serves a real game: its page, the manifest beside the build and the blobs the manifest names', async () => {
    const games = await serveBuild();
    try {
      expect(await games.get('/g/multi-client/b1/index.html')).toBe(200);
      expect(await games.get('/g/multi-client/b2/index.html')).toBe(200);
      expect(await games.get('/g/multi-client/b1/assets/manifest.json')).toBe(200);
      expect(await games.get('/assets/index-abc.js')).toBe(200);
      expect(await games.get('/a/mossbeard.0f1e2d.glb')).toBe(200);
    } finally {
      await games.close();
    }
  });

  it('serves no other build, no directory and nothing outside the build', async () => {
    const games = await serveBuild();
    try {
      expect(await games.get('/g/multi-client/b3/index.html')).toBe(404);
      expect(await games.get('/g/multi-client/b1/assets')).toBe(404);
      expect(await games.raw('/a/../../outside.txt')).toBe(404);
      expect(await games.get('/a/missing.glb')).toBe(404);
    } finally {
      await games.close();
    }
  });
});

describe('step 5 and games without avatars', () => {
  const text = (entities: Record<string, { playerIndex?: number; p?: number[] }>) => ({ state: { entities } });

  it('reads the x of the avatar a seat drives', () => {
    const avatars = text({ a: { playerIndex: 0, p: [10, 0] }, b: { playerIndex: 2, p: [40, 5] } });
    expect(hasAvatars(avatars)).toBe(true);
    expect(avatarX(avatars, 2)).toBe(40);
    expect(avatarX(avatars, 1)).toBeUndefined();
  });

  it('finds no avatars in a board game, so step 5 is named unchecked instead of timing out on a move', () => {
    expect(hasAvatars(text({ board: { p: [0, 0] }, piece: {} }))).toBe(false);
    expect(hasAvatars({})).toBe(false);
  });

  it('fails a run whose game never put an avatar on any seat, since the room playing is not the game playing', () => {
    /* #651: Blobs stayed on character select; seats, desyncs and the drop all passed on the rooms transport alone. */
    const menu = text({ title: { p: [0, 0] } });
    expect(playError(undefined, hasAvatars(menu))).toBe(NOT_PLAYED);
    expect(playError(undefined, hasAvatars(text({ a: { playerIndex: 0, p: [10, 0] } })))).toBeUndefined();
    /* A step that already failed names the real cause; not playing is only the verdict when nothing else broke. */
    expect(playError('seat 3 forfeit timed out', false)).toBe('seat 3 forfeit timed out');
  });
});

describe.skipIf(!enabled)('multi-client scenario (OGM_SCENARIOS=1)', () => {
  it('runs the eight §3.8 steps on a bad link and writes a four-seat report', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gm-multi-client-out-'));
    try {
      const { report, reportPath, seats } = await runMultiClient({ gameDir: TEMPLATE, out, softwareGl, link: 'bad' });

      expect(report.error).toBeUndefined();
      expect(report.verdict).toBe('pass');
      const parsed = verifyReportSchema.parse(JSON.parse(readFileSync(reportPath, 'utf8')));
      expect(parsed.clients).toBe(4);
      expect(parsed.seats).toHaveLength(4);
      expect(parsed.link).toEqual(BAD_LINK);
      expect(parsed.unchecked).toEqual(expect.arrayContaining(['iPhone Safari', 'WAN latency', 'a real phone']));
      expect(seats.map((seat) => seat.seat)).toEqual([0, 1, 2, 3]);
      expect(Number(report.probes.welcomeMs)).toBeLessThanOrEqual(LIMITS.welcomeMs);
      expect(Number(report.probes.playSwitchMs)).toBeLessThanOrEqual(LIMITS.playSwitchMs);
      expect(report.probes.draftPin).toBe('b2');
      expect(report.probes.linkSeed).toBe(BAD_LINK.seed);
      expect(judgeSeat(seats[2]!, bandsFor(BAD_LINK), { latency: !softwareGl })).toEqual([]);
      expect(seats[2]!.recoveries).toBeGreaterThanOrEqual(1);
      expect(report.probes.forfeitedSeat).toBe(3);
      if (softwareGl) expect(report.unchecked).toContain('latency bands on a software renderer');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);

  it('runs a two-seat room with a chosen seed and a team start, and says the forfeit was skipped', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gm-multi-client-two-'));
    try {
      const start = { name: 'duo', config: { teams: 'alternate' as const } };
      const { report, seats, link } = await runMultiClient({
        ...{ gameDir: TEMPLATE, out, softwareGl, link: 'bad', clients: 2, seed: 7, start },
      });

      expect(report.error).toBeUndefined();
      expect(report.verdict).toBe('pass');
      expect(report.clients).toBe(2);
      expect(seats.map((seat) => seat.seat)).toEqual([0, 1]);
      expect(link).toEqual({ ...BAD_LINK, seed: 7 });
      expect(report.link?.seed).toBe(7);
      /* The room's seat table, not the request: the team layout took effect. */
      expect(report.probes).toMatchObject({ start: 'duo', 'start.teams': 'alternate', seatTeams: '0,1' });
      expect(report.probes).toMatchObject({ rejoinedSeat: 1, draftSeats: 2 });
      expect(report.probes.forfeitedSeat).toBeUndefined();
      expect(report.unchecked).toContain(NO_FORFEIT);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);

  it('runs the same eight steps on a clean link', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gm-multi-client-clean-'));
    try {
      const { report, seats } = await runMultiClient({ gameDir: TEMPLATE, out, softwareGl, link: 'clean' });

      expect(report.error).toBeUndefined();
      expect(report.verdict).toBe('pass');
      /* Seat 3 forfeited mid-run: its row stays in the report as evidence, but only the seats that stayed up are judged. */
      for (const seat of seats.filter((entry) => entry.seat !== Number(report.probes.forfeitedSeat))) {
        expect(seat.desyncs).toBe(0);
        expect(seat.droppedBytes).toBe(0);
        expect(seat.oversized).toBe(0);
      }
      expect(MULTI_UNCHECKED).toContain('a real phone');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});
