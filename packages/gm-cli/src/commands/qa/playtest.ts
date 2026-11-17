import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PlaytestRun } from '@ogm/gm-verify';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { readPlaytestPlan } from '../../playtest-plan.js';
import { buildUrl } from '../../qa.js';
import { niceCapture } from '../run/index.js';
import { rejectSymlinkDirectories, runChild } from '../capture/shell.js';

export const command: GmCommand = {
  name: 'qa playtest',
  summary: 'play every mode of a built game with a seeded bot at four touch sizes; fail on broken state or screen',
  usage: '<game dir> [--all-modes | --mode <id>] [--url <hosted build>] [--seconds 15] [--seed 1] [--out <dir>]',
  example: 'qa playtest games/blobs --all-modes',
  flags: {
    'all-modes': { type: 'boolean', default: false, help: 'play every mode in gm.manifest.json (default: the first)' },
    mode: { type: 'string', help: 'play only this mode id' },
    seconds: { type: 'number', default: 15, help: 'seconds of play per mode and size' },
    seed: { type: 'number', default: 1, help: 'bot seed; the same seed replays the same inputs' },
    dist: { type: 'string', help: 'built game directory (default <game>/dist)' },
    url: { type: 'string', help: 'play a hosted build instead, e.g. https://<games-host>:10000/g/<game>/<build>/' },
    out: { type: 'string', help: 'stills, clips and playtest.json (default <game>/shots/playtest)' },
    timeout: { type: 'number', default: 1800, help: 'total timeout in seconds' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 1) throw new UsageError('one game directory is required', 'gm help qa playtest');
    if (flags['all-modes'] && flags.mode !== undefined)
      throw new UsageError('--all-modes and --mode conflict', 'gm qa playtest <game> --all-modes');
    const seconds = flags.seconds as number;
    const seed = flags.seed as number;
    const timeout = flags.timeout as number;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600)
      throw new UsageError('--seconds must be between 0 and 600', 'gm help qa playtest');
    if (!Number.isInteger(seed)) throw new UsageError('--seed must be an integer', 'gm help qa playtest');
    if (!Number.isFinite(timeout) || timeout <= 0) throw new UsageError('invalid timeout', 'gm help qa playtest');
    const game = resolve(ctx.cwd, args[0]!);
    let plan;
    try {
      plan = readPlaytestPlan(game, {
        all: flags['all-modes'] === true,
        ...(typeof flags.mode === 'string' ? { mode: flags.mode } : {}),
      });
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error), 'gm help qa playtest');
    }
    let source: { dist: string } | { url: string };
    if (typeof flags.url === 'string') {
      if (flags.dist !== undefined) throw new UsageError('--url and --dist conflict', 'gm help qa playtest');
      source = { url: buildUrl({ url: flags.url.endsWith('/') ? flags.url : `${flags.url}/` }, 'playtest') };
    } else {
      const dist = resolve(ctx.cwd, typeof flags.dist === 'string' ? flags.dist : resolve(game, 'dist'));
      for (const name of ['index.html', 'design/design.json'])
        if (!existsSync(resolve(dist, name)))
          throw new UsageError(`game build is missing ${name}`, 'build the game before gm qa playtest');
      source = { dist };
    }
    const out = resolve(ctx.cwd, typeof flags.out === 'string' ? flags.out : resolve(game, 'shots/playtest'));
    rejectSymlinkDirectories(out);
    rmSync(resolve(out, 'playtest.json'), { force: true });
    mkdirSync(out, { recursive: true });

    const { acquireSlot } = await import('@ogm/gm-verify');
    const runner = fileURLToPath(import.meta.resolve('@ogm/gm-verify/app-capture/playtest'));
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const deadline = Date.now() + timeout * 1000;
    niceCapture();
    const slot = await acquireSlot({ runtimeDir: ctx.config.runtimeDir, signal: abort.signal });
    try {
      const play = (software: boolean) =>
        runChild(
          ctx.cwd,
          [
            runner,
            out,
            JSON.stringify({
              game: source,
              modes: plan.modes,
              seconds,
              seed,
              keys: plan.keys,
              board: plan.board,
              software,
            }),
          ],
          ctx.env ?? {},
          Math.max(1, deadline - Date.now()),
          abort.signal,
          process.execPath,
          ctx.json,
        );
      let code = await play(ctx.config.verifySoftwareGl);
      if (code === 42 && !ctx.config.verifySoftwareGl && !abort.signal.aborted) {
        ctx.err('playtest: GPU screenshot stalled; retrying with SwiftShader');
        code = await play(true);
      }
      if (code === 42) code = EXIT.timeout;
      if (code !== 0) {
        ctx.err(code === EXIT.timeout ? 'playtest timed out' : `playtest runner exited with code ${code}`);
        return code;
      }
    } finally {
      slot.release();
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
    const resultFile = resolve(out, 'playtest.json');
    if (!existsSync(resultFile)) throw new CommandError('playtest runner wrote no playtest.json');
    const runs = JSON.parse(readFileSync(resultFile, 'utf8')) as PlaytestRun[];
    const failed = runs.some((run) => run.failures.length);
    const shown = relative(ctx.cwd, out) || '.';
    if (ctx.json) printJson(ctx, { verdict: failed ? 'fail' : 'pass', out: shown, notes: plan.notes, runs });
    else {
      for (const note of plan.notes) ctx.out(`note: ${note}`);
      for (const run of runs) {
        ctx.out(`${run.mode} at ${run.viewport}: ${run.failures.length ? 'fail' : 'pass'}`);
        for (const line of run.failures) ctx.out(`  ${line}`);
        for (const line of run.unchecked) ctx.out(`  unchecked: ${line}`);
      }
      ctx.out(`${failed ? 'fail' : 'pass'}: stills and clips in ${shown}`);
    }
    return failed ? EXIT.failed : EXIT.ok;
  },
};
