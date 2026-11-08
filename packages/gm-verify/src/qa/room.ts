import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Browser, BrowserContext } from 'playwright';

import { VIEWPORTS } from '../browser.js';
import { FfmpegMissingError, hasFfmpeg } from '../capture.js';
import { ConsoleCollector } from '../console.js';
import type { ConsoleEntry, ViewportName } from '../report.js';
import type { ExpectStep, RoomJourney } from './journey.js';
import { encodeGif, sideBySide } from './media.js';
import { watchConsole } from './open.js';
import { Player, type StepResult } from './player.js';

export const MIN_CLIENTS = 2;
export const MAX_CLIENTS = 4;
export const ROOM_RESULT = 'qa-room.json';

export type RoomCheckName = 'host' | 'join' | 'seated' | 'start' | 'countdown' | 'move' | 'rejoin';
export type RoomCheck = { name: RoomCheckName; ok: boolean; detail: string; steps: (StepResult & { seat: number })[] };

export type QaRoomResult = {
  journey: string;
  url: string;
  clients: { seat: number; viewport: ViewportName; console: ConsoleEntry[] }[];
  checks: RoomCheck[];
  verdict: 'pass' | 'fail';
  tile: string | null;
  clip: { mp4: string; gif: string } | null;
  unchecked: string[];
};

/** Seat 0 hosts on a desktop; the rest alternate phone and desktop so every room mixes both. */
export function viewportFor(seat: number): ViewportName {
  return seat % 2 === 0 ? 'desktop' : 'phone';
}

/**
 * The countdown is in sync when every client saw it within `spreadMs` of the first. Returns the spread, or the reason
 * the check cannot pass.
 */
export function countdownSpread(metAt: (number | undefined)[], spreadMs: number): { ok: boolean; detail: string } {
  if (metAt.some((t) => t === undefined)) return { ok: false, detail: 'a client never saw the countdown' };
  const times = metAt as number[];
  const spread = Math.max(...times) - Math.min(...times);
  return { ok: spread <= spreadMs, detail: `countdown spread ${spread}ms (limit ${spreadMs}ms)` };
}

type Client = {
  seat: number;
  viewport: ViewportName;
  context: BrowserContext;
  player: Player;
  console: ConsoleCollector;
};

/**
 * Plays a room journey with 2-4 real clients on one build: seat 0 creates the room, the others join with what it read
 * (`{code}`, a link). Checks seats, a synced countdown, a move on seat 0 seen by every other seat, and the last seat
 * dropping and rejoining. Writes stills, `room.png` (tiled), `room.mp4`/`room.gif` (stacked) and `qa-room.json`.
 */
export async function qaRoom(
  browser: Browser,
  url: string,
  journey: RoomJourney,
  options: { outDir: string; clients: number; ffmpegBinary?: string },
): Promise<QaRoomResult> {
  if (!Number.isInteger(options.clients) || options.clients < MIN_CLIENTS || options.clients > MAX_CLIENTS)
    throw new Error(`clients must be ${MIN_CLIENTS}-${MAX_CLIENTS}`);
  const dir = join(options.outDir, journey.name);
  const videoDir = join(dir, '.video');
  mkdirSync(videoDir, { recursive: true });
  const startedAt = Date.now();
  const clients: Client[] = [];
  const checks: RoomCheck[] = [];
  const stills: string[] = [];
  const videos: string[] = [];
  const binary = options.ffmpegBinary ?? 'ffmpeg';
  const unchecked: string[] = [];

  const record = (
    name: RoomCheckName,
    perSeat: { seat: number; steps: StepResult[] }[],
    extra?: { ok: boolean; detail: string },
  ): boolean => {
    const steps = perSeat.flatMap(({ seat, steps: s }) => s.map((step) => ({ ...step, seat })));
    const ok = steps.every((s) => s.ok) && (extra?.ok ?? true);
    const failed = steps.find((s) => !s.ok);
    checks.push({
      name,
      ok,
      detail: failed ? `seat ${failed.seat}: ${failed.step}: ${failed.error}` : (extra?.detail ?? ''),
      steps,
    });
    return ok;
  };
  const expectAll = (step: ExpectStep, seats: Client[], index: number) =>
    Promise.all(seats.map(async (c) => ({ seat: c.seat, steps: [await c.player.run(step, index)] })));

  try {
    for (let seat = 0; seat < options.clients; seat += 1) {
      const viewport = viewportFor(seat);
      const size = VIEWPORTS[viewport].viewport ?? { width: 1280, height: 720 };
      const context = await browser.newContext({
        ...VIEWPORTS[viewport],
        recordVideo: { dir: join(videoDir, String(seat)), size },
      });
      const page = await context.newPage();
      const collector = new ConsoleCollector();
      watchConsole(page, collector);
      const player = new Player(page, dir, {
        label: `seat${seat}`,
        touch: VIEWPORTS[viewport].hasTouch === true,
        vars: { clients: String(options.clients), seat: String(seat) },
        startedAt,
      });
      clients.push({ seat, viewport, context, player, console: collector });
    }
    const [host, ...guests] = clients as [Client, ...Client[]];

    await host.player.page.goto(url, { waitUntil: 'load' });
    const hosted = record('host', [{ seat: 0, steps: await host.player.runAll(journey.host) }]);
    let ok = hosted;
    if (ok) {
      const joined: { seat: number; steps: StepResult[] }[] = [];
      for (const guest of guests) {
        Object.assign(guest.player.vars, host.player.vars, { seat: String(guest.seat) });
        await guest.player.page.goto(url, { waitUntil: 'load' });
        joined.push({ seat: guest.seat, steps: await guest.player.runAll(journey.join) });
      }
      ok = record('join', joined);
    }
    if (ok) ok = record('seated', await expectAll(journey.seated, clients, 0));
    if (ok && journey.start.length > 0)
      ok = record('start', [{ seat: 0, steps: await host.player.runAll(journey.start) }]);
    if (ok) {
      const seen = await expectAll(journey.countdown, clients, 0);
      const spread = countdownSpread(
        seen.map((s) => (s.steps[0]?.ok ? s.steps[0].metAt : undefined)),
        journey.countdownSpreadMs,
      );
      ok = record('countdown', seen, spread);
    }
    if (ok) {
      /* Each guest's `changed` baseline is its frame before seat 0 moves; the wait starts once the move is done. */
      await Promise.all(guests.map((g) => g.player.mark()));
      const moved = await host.player.runAll(journey.move.steps);
      const seen = await Promise.all(
        guests.map(async (g) => ({ seat: g.seat, steps: [await g.player.run(journey.move.expect, 1)] })),
      );
      ok = record('move', [{ seat: 0, steps: moved }, ...seen]);
    }
    for (const c of clients) stills.push(join(dir, await c.player.shot('room')));
    if (ok) {
      const dropper = clients[clients.length - 1]!;
      const back = dropper.player.page.url();
      /* about:blank closes the page's sockets for real while its recording carries on. */
      await dropper.player.page.goto('about:blank');
      await dropper.player.page.waitForTimeout(journey.dropMs);
      await dropper.player.page.goto(back, { waitUntil: 'load' });
      const rejoined = await dropper.player.run(journey.rejoin, 0);
      const hostSees = await host.player.run(journey.seated, 1);
      record('rejoin', [
        { seat: dropper.seat, steps: [rejoined] },
        { seat: 0, steps: [hostSees] },
      ]);
    }
    for (const c of clients) {
      const video = c.player.page.video();
      await c.context.close();
      const path = await video?.path();
      if (path) videos.push(path);
    }
  } finally {
    await Promise.all(clients.map((c) => c.context.close().catch(() => undefined)));
  }

  let tileFile: string | null = null;
  let clip: QaRoomResult['clip'] = null;
  try {
    if (!hasFfmpeg(binary)) throw new FfmpegMissingError(binary);
    sideBySide(stills, join(dir, 'room.png'), false, binary);
    tileFile = 'room.png';
    if (videos.length === clients.length) {
      sideBySide(videos, join(dir, 'room.mp4'), true, binary);
      encodeGif(join(dir, 'room.mp4'), join(dir, 'room.gif'), binary);
      clip = { mp4: 'room.mp4', gif: 'room.gif' };
    } else unchecked.push('clip (a client left no recording)');
  } catch (error) {
    unchecked.push(`tile and clip (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    rmSync(videoDir, { recursive: true, force: true });
  }

  const names: RoomCheckName[] = ['host', 'join', 'seated', 'countdown', 'move', 'rejoin'];
  const result: QaRoomResult = {
    journey: journey.name,
    url,
    clients: clients.map((c) => ({ seat: c.seat, viewport: c.viewport, console: c.console.list() })),
    checks,
    verdict:
      names.every((name) => checks.some((c) => c.name === name && c.ok)) && checks.every((c) => c.ok) ? 'pass' : 'fail',
    tile: tileFile,
    clip,
    unchecked,
  };
  writeFileSync(join(dir, ROOM_RESULT), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
