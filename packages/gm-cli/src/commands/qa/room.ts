import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { buildUrl, outDir, outFlag, readJourneyFlag, urlFlag, withBrowser } from '../../qa.js';

const LINKS = ['clean', 'bad'] as const;
/** The local run is gm-verify's four-client scenario; it always seats four. */
const LOCAL_CLIENTS = 4;
/** The simulator scenario finishes in a minute or two; past this it is stuck, not slow. */
const LOCAL_TIMEOUT_MS = 10 * 60_000;

/** gm-verify's scenario runner, beside its built package: `<pkg>/dist/index.js` → `<pkg>/scenarios/scenario.ts`. */
export function scenarioScript(): string {
  return fileURLToPath(new URL('../scenarios/scenario.ts', import.meta.resolve('@ogm/gm-verify')));
}

export const command: GmCommand = {
  name: 'qa room',
  summary: 'play one room with 2-4 phone and desktop clients: seats, synced countdown, moves, drop and rejoin',
  usage: '--url <build> --journey <room.json> [--clients 2-4] [--out shots/qa] | --local [--link clean|bad]',
  example:
    'qa room --url https://<games-host>:10000/g/<game>/<build>/ --journey qa/journeys/online-2p.json --clients 2',
  flags: {
    ...urlFlag,
    ...outFlag,
    journey: { type: 'string', help: 'a room journey JSON file' },
    clients: { type: 'number', help: 'how many clients, 2-4 (default 2; --local always seats 4)' },
    local: { type: 'boolean', default: false, help: "this game's local build on the seeded network simulator" },
    link: { type: 'string', default: 'bad', help: 'with --local: clean, or bad (seeded latency, loss and a drop)' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help qa room');
    const dir = outDir(ctx, flags);
    if (flags.local === true) {
      if (flags.url !== undefined)
        throw new UsageError('--local tests the local build, not --url', 'gm qa room --local');
      if (flags.clients !== undefined && flags.clients !== LOCAL_CLIENTS)
        throw new UsageError(`--local always seats ${LOCAL_CLIENTS} clients`, 'gm qa room --local');
      if (!LINKS.includes(flags.link as (typeof LINKS)[number]))
        throw new UsageError('--link must be clean or bad', 'gm qa room --local --link bad');
      const game = gameDir(ctx.cwd, workspaceRoot(ctx.cwd));
      const out = resolve(dir, 'room-local');
      const child = spawnSync(
        process.execPath,
        [scenarioScript(), 'multi-client', '--game', game, '--out', out, '--link', flags.link as string],
        { cwd: ctx.cwd, encoding: 'utf8', timeout: LOCAL_TIMEOUT_MS, killSignal: 'SIGKILL' },
      );
      for (const line of `${child.stdout ?? ''}`.split('\n').filter(Boolean)) ctx.out(line);
      for (const line of `${child.stderr ?? ''}`.split('\n').filter(Boolean)) ctx.err(line);
      if (child.signal) {
        ctx.err(`the local room stopped after ${LOCAL_TIMEOUT_MS / 60_000} minutes (${child.signal})`);
        return EXIT.failed;
      }
      if (child.error) throw new UsageError(`cannot run the local room: ${child.error.message}`, 'pnpm install');
      return child.status === 0 ? EXIT.ok : EXIT.failed;
    }
    const url = buildUrl(flags, 'room');
    const clients = flags.clients === undefined ? 2 : (flags.clients as number);
    if (!Number.isInteger(clients) || clients < 2 || clients > 4)
      throw new UsageError('--clients must be 2, 3 or 4', 'gm qa room --clients 2');
    const journey = await readJourneyFlag(ctx, flags, 'room');
    if (journey.kind !== 'room')
      throw new UsageError(`${journey.name} is not a room journey`, `gm qa drive --journey ${String(flags.journey)}`);
    const { qaRoom } = await import('@ogm/gm-verify');
    const result = await withBrowser(ctx, (browser) => qaRoom(browser, url, journey, { outDir: dir, clients }));
    const shown = `${relative(ctx.cwd, dir) || '.'}/${journey.name}`;
    if (ctx.json) printJson(ctx, { out: shown, ...result });
    else {
      ctx.out(`clients ${result.clients.map((c) => `${c.seat}:${c.viewport}`).join(' ')}`);
      for (const check of result.checks)
        ctx.out(`${check.ok ? 'pass' : 'FAIL'} ${check.name}${check.detail ? `: ${check.detail}` : ''}`);
      for (const note of result.unchecked) ctx.out(`unchecked ${note}`);
      ctx.out(`${result.verdict} ${shown}/qa-room.json`);
    }
    return result.verdict === 'pass' ? EXIT.ok : EXIT.failed;
  },
};
