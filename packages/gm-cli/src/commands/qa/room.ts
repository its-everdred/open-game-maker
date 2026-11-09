import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { buildUrl, outDir, outFlag, readJourneyFlag, urlFlag, withBrowser } from '../../qa.js';

const LINKS = ['clean', 'bad'] as const;
/** The local run is gm-verify's multi-client scenario; it seats four unless `--clients` says otherwise. */
const LOCAL_CLIENTS = 4;
/** The simulator scenario finishes in a minute or two; past this it is stuck, not slow. */
const LOCAL_TIMEOUT_MS = 10 * 60_000;

/** gm-verify's scenario runner, beside its built package: `<pkg>/dist/index.js` → `<pkg>/scenarios/scenario.ts`. */
export function scenarioScript(): string {
  return fileURLToPath(new URL('../scenarios/scenario.ts', import.meta.resolve('@ogm/gm-verify')));
}

/**
 * Why `--local` cannot run from here, or undefined in a core checkout. The scenario is TypeScript that Node will not strip
 * under `node_modules`, and it needs the rooms service and gm-verify's dev dependencies, which a game instance's vendored
 * packages do not carry.
 */
export function localRoomBlocker(script: string): string | undefined {
  if (!script.split(/[\\/]/).includes('node_modules')) return undefined;
  return '--local runs only from an Open Game Maker core checkout, not a game instance';
}

/** The scenario's arguments for `--local`: it validates `--seed` and reads `--start` from the game's `qa/starts.json`. */
export function localScenarioArgs(
  game: string,
  out: string,
  flags: { link: string; clients?: number; seed?: string; start?: string },
): string[] {
  return [
    'multi-client',
    ...['--game', game, '--out', out, '--link', flags.link, '--clients', String(flags.clients ?? LOCAL_CLIENTS)],
    ...(flags.seed === undefined ? [] : ['--seed', flags.seed]),
    ...(flags.start === undefined ? [] : ['--start', flags.start]),
  ];
}

export const command: GmCommand = {
  name: 'qa room',
  summary: 'play one room with 2-4 phone and desktop clients: seats, synced countdown, moves, drop and rejoin',
  usage:
    '--url <build> --journey <room.json> [--clients 2-4] [--out shots/qa] | --local [--link clean|bad] [--clients 2-4]' +
    ' [--seed <n>] [--start <name>]',
  example:
    'qa room --url https://<games-host>:10000/g/<game>/<build>/ --journey qa/journeys/online-2p.json --clients 2',
  flags: {
    ...urlFlag,
    ...outFlag,
    journey: { type: 'string', help: 'a room journey JSON file' },
    clients: { type: 'number', help: 'how many clients, 2-4 (default 2; --local defaults to 4)' },
    local: { type: 'boolean', default: false, help: "this game's local build on the seeded network simulator" },
    link: { type: 'string', default: 'bad', help: 'with --local: clean, or bad (seeded latency, loss and a drop)' },
    seed: { type: 'string', help: "with --local: the link profile's seed" },
    start: { type: 'string', help: "with --local: a start configuration from the game's qa/starts.json" },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help qa room');
    const dir = outDir(ctx, flags);
    if (flags.local === true) {
      if (flags.url !== undefined)
        throw new UsageError('--local tests the local build, not --url', 'gm qa room --local');
      const clients = flags.clients as number | undefined;
      if (clients !== undefined && (!Number.isInteger(clients) || clients < 2 || clients > 4))
        throw new UsageError('--clients must be 2, 3 or 4', 'gm qa room --local --clients 2');
      if (!LINKS.includes(flags.link as (typeof LINKS)[number]))
        throw new UsageError('--link must be clean or bad', 'gm qa room --local --link bad');
      const script = scenarioScript();
      const blocker = localRoomBlocker(script);
      if (blocker) throw new UsageError(blocker, 'gm qa room --url <build> --journey <room.json>');
      const game = gameDir(ctx.cwd, workspaceRoot(ctx.cwd));
      const out = resolve(dir, 'room-local');
      const child = spawnSync(
        process.execPath,
        [
          script,
          ...localScenarioArgs(game, out, {
            link: flags.link as string,
            ...(clients === undefined ? {} : { clients }),
            ...(flags.seed === undefined ? {} : { seed: flags.seed as string }),
            ...(flags.start === undefined ? {} : { start: flags.start as string }),
          }),
        ],
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
    if (flags.seed !== undefined || flags.start !== undefined)
      throw new UsageError('--seed and --start apply to --local only', 'gm qa room --local --seed 7');
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
