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
    if (options === false) return { ok: true, output: ['play-area check disabled for a game without a play area'] };
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
    const code = await shell.run(
      { ...ctx, cwd: game, json: false, out: (line) => output.push(line), err: (line) => output.push(line) },
      [],
      {
        dist: 'dist',
        out: scratch,
        tap: options.tap,
        timeout: 600,
        'min-fill': options.minFill,
        'max-offset': options.maxOffset,
      },
    );
    return { ok: code === 0, output };
  } catch (error) {
    output.push(error instanceof Error ? error.message : String(error));
    return { ok: false, output };
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    if (locked) rmdirSync(lock);
  }
}
