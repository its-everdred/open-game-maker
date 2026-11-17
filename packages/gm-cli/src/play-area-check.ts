import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GmContext } from './command.js';
import { command as shell } from './commands/look/shell.js';
import { readPlayAreaConfig } from './play-area-config.js';
import { rejectSymlinkDirectories, runChild } from './commands/capture/shell.js';

/** Run a fresh shell capture so a previous passing capture cannot mask a layout regression. */
export async function checkPlayArea(ctx: GmContext, game: string): Promise<{ ok: boolean; output: string[] }> {
  const output: string[] = [];
  let scratch: string | undefined;
  let locked = false;
  const lock = join(game, '.gm-play-area-lock');
  try {
    const options = readPlayAreaConfig(game);
    try {
      mkdirSync(lock);
      locked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(
          `another play-area check owns ${lock}; remove this empty directory only if that check has stopped`,
          { cause: error },
        );
      throw error;
    }
    const pkg = JSON.parse(readFileSync(join(game, 'package.json'), 'utf8')) as { scripts?: { build?: unknown } };
    const script = pkg.scripts?.build;
    if (typeof script !== 'string' || !script || /\bgm\s+build\b/u.test(script))
      throw new Error('play-area check needs a nonrecursive game build script in package.json');
    // A no-op or partial build must not reuse any older passing files.
    rejectSymlinkDirectories(join(game, 'dist', 'design'));
    const dist = join(game, 'dist');
    const backup = mkdtempSync(join(game, '.gm-play-area-build-'));
    const oldDist = join(backup, 'dist');
    const hadDist = existsSync(dist);
    if (hadDist) renameSync(dist, oldDist);
    let preserveBackup = false;
    try {
      const abort = new AbortController();
      const stop = () => abort.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      let build: number;
      try {
        build = await runChild(game, ['run', 'build'], ctx.env ?? {}, 600_000, abort.signal, 'pnpm', true);
      } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
      }
      if (build !== 0) throw new Error(`game build failed before play-area check (exit ${build})`);
      if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'design/design.json')))
        throw new Error('game build is missing index.html or design/design.json');
    } catch (error) {
      try {
        rmSync(dist, { recursive: true, force: true });
        if (hadDist) renameSync(oldDist, dist);
      } catch {
        preserveBackup = true;
        throw new Error(`could not restore previous build; recover it from ${oldDist}`);
      }
      throw error;
    } finally {
      if (!preserveBackup) rmSync(backup, { recursive: true, force: true });
    }
    scratch = mkdtempSync(join(tmpdir(), 'gm-play-area-check-'));
    const reportOutput: string[] = [];
    const code = await shell.run(
      {
        ...ctx,
        cwd: game,
        json: true,
        fields: null,
        out: (line) => reportOutput.push(line),
        err: (line) => output.push(line),
      },
      [],
      {
        dist: 'dist',
        out: scratch,
        tap: options === false ? undefined : options.tap,
        timeout: 600,
        'min-fill': options === false ? undefined : options.minFill,
        'max-offset': options === false ? undefined : options.maxOffset,
      },
    );
    if (code !== 0) return { ok: false, output };
    const report = JSON.parse(reportOutput.join('\n')) as {
      playArea: { viewport: string; ok: boolean; fill?: number; offset?: number; error?: string }[];
      distortions: {
        element: string;
        file: string;
        natural: number;
        drawn: number;
        viewport: string;
        screen: string;
      }[];
    };
    return {
      ok: report.playArea.every((item) => item.ok) && report.distortions.length === 0,
      output: [
        ...output,
        ...report.playArea.map((item) =>
          item.error
            ? `play area: ${item.error.includes('not declared') ? 'not declared' : item.error} at ${item.viewport}: fail`
            : `board fill ${item.fill!.toFixed(2)} at ${item.viewport}, offset ${item.offset!.toFixed(2)}: ${item.ok ? 'pass' : 'fail'}`,
        ),
        ...report.distortions.map(
          (item) =>
            `image distortion: ${item.element} ${item.file} natural ${item.natural.toFixed(3)} drawn ${item.drawn.toFixed(3)} at ${item.viewport} (${item.screen}): fail`,
        ),
      ],
    };
  } catch (error) {
    output.push(error instanceof Error ? error.message : String(error));
    return { ok: false, output };
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    if (locked) rmdirSync(lock);
  }
}
