/**
 * Four-client verify (N6, netcode platform §8.3, research #499 §3.8).
 *
 *   pnpm --filter @ogm/gm-verify scenario multi-client --game <gameDir> [--link clean|bad|@<file>] [--out <dir>]
 *
 * Four Playwright contexts against a scenario-owned local rooms service on protocol 2, through a seeded link simulator:
 * latency, jitter, loss and reordering on the game's channels, plus scheduled socket drops that are real reconnects.
 * The two-client scenario is kept beside this one (D-N6-2) — it is the evidence path for the v1 `host-left` assertion.
 *
 * Every server binds `127.0.0.1`; everything started here is stopped in `finally`. Timings land in the verify report as
 * probes, and each assertion failure is the report's `error`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { loadavg, tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALWAYS_UNCHECKED,
  BAD_LINK,
  CLEAN_LINK,
  ConsoleCollector,
  GM_VERIFY_VERSION,
  isSoftware,
  launch,
  newRunId,
  rendererString,
  unknownBudgets,
  verdictFor,
  writeReport,
  type LinkConfig,
  type SeatMetrics,
  type VerifyReport,
} from '@ogm/gm-verify';
import { signGrant } from '@ogm/room-protocol';
import { build } from 'esbuild';
import type { Browser, BrowserContext, Page } from 'playwright';

import { framesContaining, newCanary } from './two-client.ts';
import type {} from './multi-client/harness.ts';
import type { HarnessSnapshot } from './multi-client/harness.ts';

export type LinkProfileName = 'clean' | 'bad';

export type MultiClientOptions = {
  gameDir: string;
  out: string;
  softwareGl?: boolean;
  roomsDist?: string;
  /** `clean`, `bad`, or a profile object replayed from a report's `link` (research §3.8's `--link @<file>`). */
  link?: LinkProfileName | LinkConfig;
  log?: (line: string) => void;
};

export type MultiClientResult = { report: VerifyReport; reportPath: string; seats: SeatMetrics[]; link: LinkConfig };

export const LIMITS = { welcomeMs: 2_000, playSwitchMs: 500 } as const;
/** `seatReconnectSec` is short so step 6 can prove a forfeit inside one run; seat 2 returns first, seat 3 does not. */
export const MULTI_TIMINGS = {
  ownerReconnectSec: 2,
  playerReconnectSec: 1,
  seatReconnectSec: 4,
  idleDisposeSec: 5,
} as const;
export const MULTI_UNCHECKED = ['WAN latency', 'a real phone'] as const;
/**
 * The room's `playing` is the service's phase, not the game's: a game still on its menu passes every transport step.
 * Only a peer's avatar moving on another seat proves the game itself played online, so a run that never saw one fails.
 */
export const NOT_PLAYED =
  "the game's online play was not exercised: no seat had a playerIndex entity to move, so the room ran but the game " +
  'never started a match (start it when the room starts playing, or give each seat an avatar)';

/** How long step 5 waits for avatars after the room plays: a game may run its own countdown before it spawns them. */
export const AVATAR_WAIT_MS = 10_000;

/** The run's error: an earlier failure stands; otherwise {@link NOT_PLAYED} when step 5 found no avatars to move. */
export function playError(error: string | undefined, sawAvatars: boolean): string | undefined {
  return error ?? (sawAvatars ? undefined : NOT_PLAYED);
}

const PIN = { gameId: 'multi-client', branchId: 'main', buildId: 'b1' } as const;
const DRAFT_BUILD = 'b2';
const SEATS = [
  { sub: 'seat-0', name: 'Primary' },
  { sub: 'seat-1', name: 'Peer one' },
  { sub: 'seat-2', name: 'Peer two' },
  { sub: 'seat-3', name: 'Peer three' },
] as const;

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../../..');

class ScenarioFailure extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScenarioFailure(message);
}

export function profileFor(link: LinkProfileName | LinkConfig | undefined): LinkConfig {
  if (link === undefined) return BAD_LINK;
  if (typeof link === 'string') {
    if (link === 'clean') return CLEAN_LINK;
    if (link === 'bad') return BAD_LINK;
    throw new ScenarioFailure(`unknown link profile ${link}; use clean, bad, or @<report.json>`);
  }
  return link;
}

/**
 * The bands of §3.10. A deliberately impaired run cannot be held to the relay budget — 80 ms of simulated RTT already
 * exceeds the 150 ms event target — so the impairment is written into the bound instead of the run being excused.
 *
 * A remote update is more than the path: the sender's input sits in its jitter buffer before it is applied
 * (`inputDelayTicks` at 60 Hz) and the receiver only sees the snapshot that carries it (one interval at the manifest's
 * `snapshotHz`). Both are added, so the band says *why* it is wider than the path rather than padding a measured number.
 */
export function bandsFor(link: LinkConfig, game = { inputDelayTicks: 3, snapshotHz: 20 }) {
  /*
   * Four browser contexts render on one host, and CI (or a laptop) may run them on SwiftShader. The budget above is the
   * network's; this share is the machine's, named rather than hidden in a bigger constant (research §9).
   */
  const HOST_SHARE = 1.25;
  const slack = link.latencyMs + 2 * link.jitterMs;
  const interval = Math.round(1_000 / game.snapshotHz);
  const simulation = Math.round(game.inputDelayTicks * (1_000 / 60)) + interval;
  /* A lost or reordered input is rebuilt from its repeat, which costs up to one more snapshot interval. */
  const recovery = link.lossPct > 0 || link.reorderPct > 0 ? interval : 0;
  return {
    localResponseMs: 17,
    remoteUpdateP95Ms: Math.round((100 + slack + simulation + recovery) * HOST_SHARE),
    eventDelayP95Ms: Math.round((150 + slack) * HOST_SHARE),
    inputGaps: link.lossPct > 0 ? 2 : 1,
    /** A disconnect profile must show that a reconnected seat caught up. */
    needsRecovery: link.disconnects.length > 0,
  };
}

/**
 * Every way one seat misses the band, so a failing run names the seats and the numbers.
 *
 * `latency` is the one judgement that needs a machine, not a network: on a software renderer four contexts share a CPU
 * and a remote update waits whole frames, so its p95 measures the host. The run still records and reports those numbers,
 * and names them in `unchecked` instead of pretending they were met.
 */
export function judgeSeat(seat: SeatMetrics, bands = bandsFor(BAD_LINK), options = { latency: true }): string[] {
  const failures: string[] = [];
  const over = (label: string, value: number, limit: number) => {
    if (value > limit) failures.push(`seat ${seat.seat} ${label} ${value} > ${limit}`);
  };
  over('localResponseMs', seat.localResponseMs, bands.localResponseMs);
  if (options.latency) {
    over('remoteUpdateP95Ms', seat.remoteUpdateP95Ms, bands.remoteUpdateP95Ms);
    over('eventDelayP95Ms', seat.eventDelayP95Ms, bands.eventDelayP95Ms);
  }
  over('inputGaps', seat.inputGaps, bands.inputGaps);
  over('desyncs', seat.desyncs, 0);
  over('hardResyncs', seat.hardResyncs, 0);
  over('oversized', seat.oversized, 0);
  if (bands.needsRecovery && seat.recoveries < 1 && seat.seat === 2) {
    failures.push(`seat 2 recoveries ${seat.recoveries} < 1 after its 3 s drop`);
  }
  return failures;
}

/**
 * A sample that spans a disconnect is a stall, not a latency: one step cannot legitimately take a second, and the seat
 * that dropped for 3 s otherwise reports the whole window as its worst remote update. Those samples are dropped from the
 * p95 fold and counted in the report's probes (research §9: sample only inside running windows).
 */
export const STALL_SAMPLE_MS = 1_000;

/** How long after a rejoin a seat is still catching up: its state is real, but it is not a latency measurement. */
export const RECOVERY_SETTLE_MS = 2_000;

/**
 * Keeps the samples that measure the link. A seat that is down, or still catching up after a rejoin, produces real
 * numbers that are not latency — a 3 s drop shows up as a 3 s "remote update" — so samples inside the recovery window
 * (the drop itself plus {@link RECOVERY_SETTLE_MS} of catch-up) are dropped from the p95 fold and counted in the probe.
 */
export function withoutStalls(samples: readonly HarnessSnapshot[], settleMs = RECOVERY_SETTLE_MS): HarnessSnapshot[] {
  return samples.filter((sample) => {
    if (sample.remoteUpdateMs > STALL_SAMPLE_MS || sample.eventDelayMs > STALL_SAMPLE_MS) return false;
    const since = Math.max(sample.rejoinedAt ?? 0, sample.droppedAt ?? 0);
    return since === 0 || sample.at - since > settleMs;
  });
}

/** One page's samples, folded into the one report entry the seat gets: latest gauges, p95 for the two delays. */
export function toSeatMetrics(seat: number, samples: readonly HarnessSnapshot[]): SeatMetrics {
  assert(samples.length > 0, `no metric samples for seat ${seat}`);
  const latest = samples[samples.length - 1]!;
  const p95 = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length, Math.ceil(0.95 * sorted.length)) - 1]!;
  };

  return {
    seat,
    buildId: latest.buildId,
    ...(latest.rulesetHash === undefined ? {} : { rulesetHash: latest.rulesetHash }),
    ...(latest.epoch === '' ? {} : { epoch: latest.epoch }),
    mode: latest.mode,
    tick: latest.tick,
    rttMs: latest.rttMs,
    jitterMs: latest.jitterMs,
    lossPct: latest.lossPct,
    clockOffsetMs: latest.clockOffsetMs,
    lateStartTicks: latest.lateStartTicks,
    inputDelayTicks: latest.inputDelayTicks,
    inputGaps: latest.inputGaps,
    localResponseMs: latest.localResponseMs,
    remoteUpdateP95Ms: p95(samples.map((sample) => sample.remoteUpdateMs)),
    eventDelayP95Ms: p95(samples.map((sample) => sample.eventDelayMs)),
    desyncs: latest.desyncs,
    recoveries: Math.max(...samples.map((sample) => sample.recoveries)),
    hardResyncs: latest.hardResyncs,
    droppedBytes: latest.droppedBytes,
    oversized: latest.oversized,
  };
}

/* ------------------------------------------------------------------ tiny local servers, on 127.0.0.1 only */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

function sendFile(response: ServerResponse, path: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  response.end(readFileSync(path));
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server has no port');
  return address.port;
}

async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise((done) => server.close(done));
  return port;
}

/**
 * The games origin for one built game. A build's page and everything it loads relative to itself (its asset manifest at
 * `/g/<id>/<build>/assets/manifest.json`) come from the build; root `/assets/` chunks and the content-addressed `/a/<file>`
 * blobs the manifest names (`gm build assets` writes them to `public/a`) come from the same output.
 */
export function gamesServer(dist: string): Server {
  const builds = new Set<string>([PIN.buildId, DRAFT_BUILD]);
  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (!path.includes('..')) {
      const inBuild = /^\/g\/[^/]+\/([^/]+)\/(.+)$/.exec(path);
      if (inBuild && builds.has(inBuild[1]!)) return sendFile(response, join(dist, inBuild[2]!));
      if (path.startsWith('/assets/') || path.startsWith('/a/')) return sendFile(response, join(dist, path));
    }
    response.writeHead(404).end('not found');
  });
}

function appServer(dir: string): Server {
  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/harness.js') return sendFile(response, join(dir, 'harness.js'));
    if (path === '/') return sendFile(response, join(HERE, 'multi-client', 'harness.html'));
    response.writeHead(404).end('not found');
  });
}

/** Stands in for the API's internal `ended` callback and records what the room reported. */
function endedServer(ended: { roomId: string; reason: string }[], secret: string): Server {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    const match = /^\/internal\/rooms\/([^/]+)\/ended$/.exec(request.url ?? '');
    if (request.method !== 'POST' || !match || request.headers.authorization !== `Bearer ${secret}`) {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      let reason: unknown;
      try {
        reason = (JSON.parse(body) as { reason?: unknown }).reason;
      } catch {
        response.writeHead(400).end();
        return;
      }
      ended.push({ roomId: decodeURIComponent(match[1]!), reason: String(reason) });
      response.writeHead(204).end();
    });
  });
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${command} ${args.join(' ')} failed: ${stderr.trim().slice(-400)}`)),
    );
  });
}

async function startRooms(roomsDist: string, env: Record<string, string>): Promise<ChildProcess> {
  for (const file of ['server.js', 'config.js', 'lifecycle.js']) {
    const path = join(roomsDist, file);
    if (!existsSync(path)) throw new Error(`rooms build not found: ${path} (run pnpm --filter @ogm/rooms build)`);
  }
  const child = spawn(
    process.execPath,
    [join(HERE, 'multi-client', 'rooms.ts'), roomsDist, JSON.stringify(MULTI_TIMINGS)],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new Error(`rooms did not start: ${stderr.slice(-400)}`));
    }, 20_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      if (!chunk.toString('utf8').includes('"listening"')) return;
      clearTimeout(timer);
      done();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`rooms exited with ${code}: ${stderr.slice(-400)}`));
    });
  });
  return child;
}

type Client = {
  context: BrowserContext;
  page: Page;
  received: (string | Buffer)[];
  sent: (string | Buffer)[];
  samples: HarnessSnapshot[];
};

/**
 * `collecting` gates the console capture: a page torn down while the browser closes reports failures that belong to the
 * teardown, not to the run, and a diagnostics-free run must not go red for them.
 */
async function openClient(
  browser: Browser,
  appUrl: string,
  collector: ConsoleCollector,
  collecting: () => boolean,
): Promise<Client> {
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await context.newPage();
  const received: (string | Buffer)[] = [];
  const sent: (string | Buffer)[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => received.push(payload));
    socket.on('framesent', ({ payload }) => sent.push(payload));
  });
  page.on('pageerror', (error) => {
    if (collecting()) collector.add('error', error.message);
  });
  page.on('console', (message) => {
    if (collecting() && message.type() === 'error') collector.add('error', message.text());
  });
  await page.goto(appUrl);
  await page.waitForFunction(() => window.__multiHarness !== undefined);
  return { context, page, received, sent, samples: [] };
}

async function until(page: Page, predicate: string | (() => unknown), timeoutMs: number, what: string): Promise<void> {
  try {
    await page.waitForFunction(predicate, undefined, { timeout: timeoutMs, polling: 10 });
  } catch {
    throw new ScenarioFailure(`timed out after ${timeoutMs} ms waiting for ${what}`);
  }
}

async function untilNode(page: Page, check: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new ScenarioFailure(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await page.waitForTimeout(50);
  }
}

type EntitySnapshot = { playerIndex?: number; p?: number[] };
export type GameText = { state?: { entities?: Record<string, EntitySnapshot> } };

/** The x of the entity a seat drives, or undefined when the game gives that seat no avatar. */
export function avatarX(text: GameText, playerIndex: number): number | undefined {
  const entity = Object.values(text.state?.entities ?? {}).find((candidate) => candidate.playerIndex === playerIndex);
  return entity?.p?.[0];
}

/** Step 5 moves avatars; a game without any (a board game, or one still on its menu) fails with {@link NOT_PLAYED}. */
export function hasAvatars(text: GameText): boolean {
  return Object.values(text.state?.entities ?? {}).some((entity) => typeof entity.playerIndex === 'number');
}

async function gameText(page: Page): Promise<GameText> {
  return (await page.evaluate(() => window.__multiHarness.renderGameToText())) as GameText;
}

async function playerX(page: Page, playerIndex: number): Promise<number | undefined> {
  return avatarX(await gameText(page), playerIndex);
}

function stableId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = randomBytes(25);
  return `e_${'01234567'[bytes[0]! % 8]}${[...bytes.subarray(1), ...randomBytes(1)].map((byte) => alphabet[byte % 32]).join('')}`;
}

/** Samples every page's own metrics every 500 ms for as long as the match runs, so a single end sample cannot lie. */
function startSampling(clients: Client[]): () => void {
  let active = true;
  const tick = async () => {
    for (const client of clients) {
      if (!active) return;
      const sample = (await client.page.evaluate(() => window.__multiHarness.netMetrics()).catch(() => undefined)) as
        HarnessSnapshot | undefined;
      if (sample !== undefined) client.samples.push(sample);
    }
  };
  const timer = setInterval(() => void tick(), 500);
  void tick();
  return () => {
    active = false;
    clearInterval(timer);
  };
}

export async function runMultiClient(options: MultiClientOptions): Promise<MultiClientResult> {
  const log = options.log ?? (() => {});
  const startedAt = new Date().toISOString();
  const out = resolve(options.out);
  mkdirSync(join(out, 'steps'), { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'gm-multi-client-'));
  const software = options.softwareGl ?? false;
  const consoleEntries = new ConsoleCollector();
  const probes: VerifyReport['probes'] = { loadavg1: Number(loadavg()[0]!.toFixed(2)) };
  const frames: VerifyReport['frames'] = [];
  const ended: { roomId: string; reason: string }[] = [];
  const canary = newCanary();
  const link = profileFor(options.link);
  const bands = bandsFor(link);
  const servers: Server[] = [];
  let rooms: ChildProcess | undefined;
  let browser: Browser | undefined;
  let collecting = true;
  let stopSampling: (() => void) | undefined;
  let renderer = 'unknown';
  let error: string | undefined;
  let stepStartedAt = Date.now();
  const seats: SeatMetrics[] = [];
  let clients: Client[] = [];
  /** The seats this run took offline itself (step 6), on top of whatever the profile schedules. */
  const droppedSeats = new Set<number>();
  /** Checks this game cannot be judged by, named in the report instead of failed or silently skipped. */
  const unchecked: string[] = [];
  /** Whether step 5 found avatars to move; a run without them goes on for its evidence but cannot pass. */
  let avatars = false;

  /** The game declares its authority mode in its manifest; the room is created with the same one (D-NET-1). */
  const manifestNet = ((): { authority?: string; maxSeats?: number } => {
    try {
      const manifest = JSON.parse(readFileSync(join(resolve(options.gameDir), 'gm.manifest.json'), 'utf8')) as {
        net?: { authority?: string; maxSeats?: number };
      };
      return manifest.net ?? {};
    } catch {
      return {};
    }
  })();
  const roomMode = manifestNet.authority ?? 'per-seat';
  const roomSeats = Math.max(SEATS.length, Math.min(manifestNet.maxSeats ?? SEATS.length, 8));

  const grantSecret = randomBytes(32).toString('hex');
  const internalSecret = randomBytes(32).toString('hex');

  try {
    const gameDir = resolve(options.gameDir);
    log(`build ${gameDir}`);
    await run(
      'pnpm',
      ['exec', 'vite', 'build', '--mode', 'draft', '--outDir', join(work, 'game'), '--emptyOutDir'],
      gameDir,
    );
    await build({
      entryPoints: [join(HERE, 'multi-client', 'harness.ts')],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      outfile: join(work, 'app', 'harness.js'),
      logLevel: 'silent',
    });

    const serve = (server: Server) => {
      servers.push(server);
      return listen(server);
    };
    const gamesPort = await serve(gamesServer(join(work, 'game')));
    const appPort = await serve(appServer(join(work, 'app')));
    const apiPort = await serve(endedServer(ended, internalSecret));
    const roomsPort = await freePort();
    const gamesOrigin = `http://127.0.0.1:${gamesPort}`;
    const appUrl = `http://127.0.0.1:${appPort}/`;
    const roomsUrl = `ws://127.0.0.1:${roomsPort}`;

    rooms = await startRooms(options.roomsDist ?? join(REPO, 'services', 'rooms', 'dist'), {
      OGM_ROOMS_PORT: String(roomsPort),
      OGM_WS_TOKEN_SECRET: grantSecret,
      OGM_ROOMS_INTERNAL_SECRET: internalSecret,
      OGM_API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
      OGM_GAMES_ORIGIN: gamesOrigin,
    });
    const createRoom = async (): Promise<string> => {
      const response = await fetch(`http://127.0.0.1:${roomsPort}/internal/rooms`, {
        method: 'POST',
        headers: { authorization: `Bearer ${internalSecret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...PIN, ownerId: SEATS[0].sub, maxPlayers: roomSeats, protocol: 2, mode: roomMode }),
      });
      assert(response.status === 201, `room creation returned ${response.status}`);
      return ((await response.json()) as { roomId: string }).roomId;
    };
    const grant = (roomId: string, who: (typeof SEATS)[number], role: 'owner' | 'player') =>
      signGrant({ ...who, roomId, gameId: PIN.gameId, role }, grantSecret);
    const joinArgs = (roomId: string, token: string) => ({
      roomsUrl,
      roomId,
      grant: token,
      buildId: PIN.buildId,
      gamesOrigin,
    });
    const shoot = async (step: number) => {
      for (const [index, client] of clients.entries()) {
        const path = `steps/${step}-seat${index}.png`;
        await client.page.screenshot({ path: join(out, path) });
        frames.push({ t: (Date.now() - stepStartedAt) / 1000, path, viewport: 'desktop' });
      }
    };

    browser = await launch(software);
    clients = [];
    for (let index = 0; index < SEATS.length; index += 1)
      clients.push(await openClient(browser, appUrl, consoleEntries, () => collecting));
    renderer = await rendererString(clients[0]!.page);
    stepStartedAt = Date.now();
    const roomId = await createRoom();
    for (const client of clients) {
      await client.page.evaluate((profile) => window.__multiHarness.setLink(profile), link);
    }

    log('1 four seats join a v2 room');
    const welcomeMs: number[] = [];
    for (const [index, client] of clients.entries()) {
      const token = await grant(roomId, SEATS[index]!, index === 0 ? 'owner' : 'player');
      await client.page.evaluate((input) => window.__multiHarness.join(input), joinArgs(roomId, token));
      const measure = (await client.page.evaluate(() => window.__multiHarness.welcomeMs)) as number | undefined;
      welcomeMs.push(Math.round(measure ?? Number.NaN));
    }
    for (const [index, client] of clients.entries()) {
      await until(client.page, () => window.__multiHarness.gameReady > 0, 30_000, `seat ${index} game`);
    }
    for (const [index, client] of clients.entries()) {
      await until(client.page, () => window.__multiHarness.seats.length === 4, 10_000, `seat ${index} seat table`);
    }
    probes.welcomeMs = Math.max(...welcomeMs);
    welcomeMs.forEach((value, index) => {
      if (index > 0) probes[`welcomeMs.seat${index}`] = value;
    });
    assert(
      welcomeMs.every((value) => value <= LIMITS.welcomeMs),
      `a seat took ${Math.max(...welcomeMs)} ms to be welcomed (limit ${LIMITS.welcomeMs})`,
    );
    const assigned = (await clients[0]!.page.evaluate(() =>
      window.__multiHarness.seats.map((seat) => seat.seat),
    )) as number[];
    assert(JSON.stringify([...assigned].sort()) === '[0,1,2,3]', `seats assigned were ${assigned.join(',')}`);
    await shoot(1);

    log('2 the primary places three entities; every watcher matches at each revision');
    for (let index = 0; index < 3; index += 1) {
      const id = stableId();
      const entity = {
        id,
        prefab: 'platform',
        level: 'main',
        origin: 'creator',
        props: { x: 300 + index * 220, y: 320 },
      };
      const rev = (await clients[0]!.page.evaluate((patch) => window.__multiHarness.sendTx([patch]), {
        op: 'add' as const,
        path: ['entities', id],
        value: entity,
      })) as number;
      for (const client of clients.slice(1)) {
        await until(client.page, `window.__multiHarness.rev >= ${rev}`, 5_000, `watcher rev ${rev}`);
        const [primaryDoc, watcherDoc] = await Promise.all(
          [clients[0]!, client].map((each) => each.page.evaluate((at) => window.__multiHarness.docs.get(at), rev)),
        );
        assert(JSON.stringify(primaryDoc) === JSON.stringify(watcherDoc), `a watcher's design differs at rev ${rev}`);
      }
      probes[`designRev${rev}`] = true;
    }
    await shoot(2);

    log('3 canary through private presence and a refused design path');
    const watcherFrames = clients.slice(1).map((client) => client.received.length);
    await clients[0]!.page.evaluate((value) => {
      window.__multiHarness.send('presence', { p: { privateMode: true, focusControlId: value, selection: [] } });
      window.__multiHarness.send('design.tx', {
        tx: {
          branchId: 'main',
          rev: 99,
          baseRev: 3,
          actor: 'seat-0',
          kind: 'manual',
          patches: [{ op: 'add', path: ['prompt', value], value }],
        },
      });
    }, canary);
    await clients[0]!.page.waitForTimeout(500);
    const sentFrames = framesContaining(clients[0]!.sent, canary);
    const leaked = clients.slice(1).reduce((total, client) => total + framesContaining(client.received, canary), 0);
    probes.canarySentFrames = sentFrames;
    probes.watcherFrames = watcherFrames.reduce((total, value) => total + value, 0);
    assert(sentFrames >= 2, `the canary reached the wire in ${sentFrames} frame(s); expected 2`);
    assert(leaked === 0, `the canary leaked into ${leaked} watcher frame(s)`);
    await shoot(3);

    log('4 the primary starts the match; all four reach playing');
    for (const client of clients) await client.page.evaluate(() => window.__multiHarness.ready(true));
    for (const [index, client] of clients.entries()) {
      await until(
        client.page,
        () => window.__multiHarness.seats.every((seat) => seat.ready),
        10_000,
        `seat ${index} to see every seat ready`,
      );
    }
    const startRequestedAt = Date.now();
    await clients[0]!.page.evaluate(() => window.__multiHarness.start(true));
    for (const [index, client] of clients.entries()) {
      await until(client.page, () => window.__multiHarness.phase === 'playing', 10_000, `seat ${index} playing`);
    }
    const playSwitchMs = Date.now() - startRequestedAt;
    probes.playSwitchMs = playSwitchMs;
    assert(playSwitchMs <= LIMITS.playSwitchMs, `playing took ${playSwitchMs} ms (limit ${LIMITS.playSwitchMs})`);
    stopSampling = startSampling(clients);
    await shoot(4);

    log('5 each peer moves its own avatar; the primary never moves');
    /* Avatars may spawn a while after playing; only a game that still has none is named unchecked, and fails. */
    for (const giveUpAt = Date.now() + AVATAR_WAIT_MS; !avatars && Date.now() < giveUpAt;) {
      avatars = hasAvatars(await gameText(clients[0]!.page));
      if (!avatars) await clients[0]!.page.waitForTimeout(100);
    }
    if (!avatars) unchecked.push('peer avatar moves (the game has no playerIndex entities)');
    for (const playerIndex of avatars ? [1, 2, 3] : []) {
      const primaryBefore = await playerX(clients[0]!.page, playerIndex);
      const primaryAnchor = await playerX(clients[0]!.page, 0);
      const mover = clients[playerIndex]!;
      await mover.page.evaluate(() => window.__multiHarness.hold({ move: 1 }, 1_000));
      await clients[0]!.page.waitForTimeout(400);
      await untilNode(
        clients[0]!.page,
        async () =>
          ((await playerX(clients[0]!.page, playerIndex)) ?? Number.NEGATIVE_INFINITY) >
          (primaryBefore ?? Number.POSITIVE_INFINITY),
        10_000,
        `peer ${playerIndex} to move on the primary`,
      );
      assert((await playerX(clients[0]!.page, 0)) === primaryAnchor, 'the primary moved on a peer input');
    }
    probes.peerMovedPx = avatars;
    await shoot(5);

    log('6 seat 2 drops for 3 s and returns; seat 3 drops past the window and forfeits');
    droppedSeats.add(2);
    await clients[2]!.page.evaluate(() => window.__multiHarness.drop(3_000));
    await until(
      clients[0]!.page,
      () => window.__multiHarness.seatEvents.some((entry) => entry.event === 'net.seat.offline' && entry.seat === 2),
      10_000,
      'seat 2 offline',
    );
    droppedSeats.add(3);
    await clients[3]!.page.evaluate(() => window.__multiHarness.drop(6_000));
    await until(
      clients[0]!.page,
      () => window.__multiHarness.seatEvents.some((entry) => entry.event === 'net.seat.forfeit' && entry.seat === 3),
      20_000,
      'seat 3 forfeit',
    );
    probes.reconnectMs = 3_000;
    probes.forfeitMs = 6_000;
    assert(
      (await clients[0]!.page.evaluate(() => window.__multiHarness.ended)) === undefined,
      'the room ended on a forfeit',
    );
    await shoot(6);

    log('7 a draft load reaches every seat still in the room');
    await clients[0]!.page.evaluate((buildId) => window.__multiHarness.loadDraft(buildId), DRAFT_BUILD);
    /* Seat 3 forfeited in step 6 and is no longer a member; the seats still seated must follow the pin. */
    const live = clients.slice(0, 3);
    for (const [index, client] of live.entries()) {
      await until(
        client.page,
        `window.__multiHarness.pinBuildId === ${JSON.stringify(DRAFT_BUILD)}`,
        30_000,
        `seat ${index} pin`,
      );
      const sent = (await client.page.evaluate(() => window.__multiHarness.draftReadySent)) as string[];
      assert(sent.includes(DRAFT_BUILD), `seat ${index} did not report draft.ready`);
    }
    probes.draftSeats = live.length;
    probes.draftPin = DRAFT_BUILD;
    stopSampling?.();
    stopSampling = undefined;
    await shoot(7);

    log('8 collect per-seat metrics');
    for (const [index, client] of clients.entries()) {
      const sample = (await client.page.evaluate(() => window.__multiHarness.netMetrics())) as HarnessSnapshot;
      client.samples.push(sample);
      seats.push(toSeatMetrics(index, withoutStalls(client.samples)));
    }
    probes.stalledSamples = clients.reduce(
      (total, client) => total + (client.samples.length - withoutStalls(client.samples).length),
      0,
    );
    /*
     * Only seats that stayed up the whole run are held to the latency bands. A seat that spent time down is still
     * recovering when the run ends: its row stays in the report as evidence and it must prove it came back, but its
     * first seconds after a rejoin are re-synchronisation rather than the steady state the band is about. A seat that
     * forfeited is out of the room altogether. Both are named in the report instead of being silently skipped.
     */
    probes.forfeitedSeat = 3;
    if (link.disconnects[0] !== undefined) probes.rejoinedSeat = link.disconnects[0].seat;
    for (const entry of link.disconnects) droppedSeats.add(entry.seat);
    const hardware = !isSoftware(renderer);
    probes.hardwareRender = hardware;
    for (const entry of seats.filter((seat) => !droppedSeats.has(seat.seat))) {
      const failures = judgeSeat(entry, bands, { latency: hardware });
      assert(failures.length === 0, failures.join('; '));
    }
    for (const entry of seats.filter((seat) => droppedSeats.has(seat.seat) && seat.seat !== 3)) {
      assert(entry.recoveries >= 1, `seat ${entry.seat} dropped and never rejoined (recoveries ${entry.recoveries})`);
    }
    probes.seats = seats.length;
    probes.linkSeed = link.seed;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    stopSampling?.();
    /* Everything after this point is teardown: a page error raised while the browser closes is not a run finding. */
    collecting = false;
    await browser?.close().catch(() => undefined);
    if (rooms && rooms.exitCode === null) {
      const exited = new Promise((done) => rooms!.once('exit', done));
      rooms.kill('SIGTERM');
      await Promise.race([exited, new Promise((done) => setTimeout(done, 3_000))]);
      if (rooms.exitCode === null) rooms.kill('SIGKILL');
    }
    await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
    rmSync(work, { recursive: true, force: true });
  }
  error = playError(error, avatars);

  const budgets = unknownBudgets();
  const consoleList = consoleEntries.list();
  const report: VerifyReport = {
    runId: newRunId(),
    renderer,
    software: isSoftware(renderer),
    viewport: 'desktop',
    tier: 'desktop',
    frames,
    console: consoleList,
    budgets,
    probes,
    clients: SEATS.length,
    seats,
    link,
    /*
     * A software renderer cannot measure the network's latency: four contexts share one CPU and a step waits whole
     * frames. The numbers are still recorded and reported; the band they would be judged against is named here.
     */
    unchecked: [
      ...ALWAYS_UNCHECKED,
      ...MULTI_UNCHECKED,
      ...unchecked,
      ...(isSoftware(renderer) ? ['latency bands on a software renderer'] : []),
    ],
    verdict: error ? 'fail' : verdictFor({ budgets, console: consoleList }),
    ...(error ? { error } : {}),
    startedAt,
    endedAt: new Date().toISOString(),
    gmVerifyVersion: GM_VERIFY_VERSION,
  };
  const reportPath = writeReport(out, report);
  return { report, reportPath, seats, link };
}
