import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
} from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson, resolveContainedPath } from '../../context.js';
import { rejectSymlinkDirectories, runChild } from '../capture/shell.js';

const sizes = ['390x844', '844x390', '820x1180', '1180x820'];

/** Honor explicitly selected symlinked roots (such as assets-local) while checking the resolved path. */
function outputPath(path: string): string {
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  return resolve(realpathSync(ancestor), relative(ancestor, path));
}

export const command: GmCommand = {
  name: 'look shell',
  summary: 'capture a local game in the real app shell with mocked sign-in',
  usage: "--dist <game dist> --out <directory> [--tap 'Play>Endless'] [--edit] [--mp4]",
  flags: {
    dist: { type: 'string', help: 'built game directory' },
    out: { type: 'string', help: 'output directory' },
    tap: { type: 'string', help: 'exact game text to tap, separated by >' },
    edit: { type: 'boolean', default: false, help: 'capture the editor' },
    mp4: { type: 'boolean', default: false, help: 'record an MP4 per viewport (requires ffmpeg)' },
    timeout: { type: 'number', default: 600, help: 'total timeout in seconds' },
  },
  async run(ctx, args, flags) {
    if (args.length || typeof flags.dist !== 'string' || typeof flags.out !== 'string')
      throw new UsageError('dist and out paths are required', 'gm help look shell');
    const timeout = flags.timeout as number;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new UsageError('invalid timeout', 'gm help look shell');
    const taps = typeof flags.tap === 'string' ? flags.tap.split('>').map((text) => text.trim()) : [];
    if (taps.some((text) => !text)) throw new UsageError('empty tap target', 'gm help look shell');
    const dist = resolve(ctx.cwd, flags.dist);
    const out = outputPath(resolve(ctx.cwd, flags.out));
    rejectSymlinkDirectories(out);
    for (const name of ['index.html', 'design/design.json']) {
      const file = await resolveContainedPath(dist, resolve(dist, name)).catch(() => null);
      if (
        !file ||
        !(await stat(file)
          .then((entry) => entry.isFile())
          .catch(() => false))
      )
        throw new UsageError(`game build is missing ${name}`, 'build the game before gm look shell');
    }
    const temp = mkdtempSync(resolve(tmpdir(), 'gm-look-shell-'));
    const lock = resolve(out, '.gm-shell-lock');
    try {
      mkdirSync(out, { recursive: true });
      rejectSymlinkDirectories(out);
      mkdirSync(lock);
    } catch (error) {
      rmSync(temp, { recursive: true, force: true });
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new CommandError(`another capture owns ${lock}; remove it only if that capture stopped`);
      throw error;
    }
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const deadline = Date.now() + timeout * 1000;
    let slot: { release(): void } | undefined;
    try {
      const { acquireSlot } = await import('@ogm/gm-verify');
      slot = await acquireSlot({
        runtimeDir: ctx.config.runtimeDir,
        waitMs: Math.min(timeout * 1000, 600_000),
        signal: abort.signal,
      });
      const remaining = deadline - Date.now();
      if (remaining <= 0) return EXIT.timeout;
      const runner = fileURLToPath(import.meta.resolve('@ogm/gm-verify/app-capture'));
      const result = await runChild(
        ctx.cwd,
        [
          runner,
          dist,
          temp,
          JSON.stringify(taps),
          flags.edit ? '1' : '0',
          flags.mp4 ? '1' : '0',
          ctx.config.verifySoftwareGl ? '1' : '0',
        ],
        ctx.env ?? {},
        remaining,
        abort.signal,
        process.execPath,
        ctx.json,
      );
      if (result !== 0) return result;
      const prefixes = ['play', 'menu', ...(taps.length ? ['ingame'] : []), ...(flags.edit ? ['edit'] : [])];
      const names = sizes.flatMap((size) => [
        ...prefixes.map((prefix) => `${prefix}-${size}.png`),
        ...(flags.mp4 ? [`motion-${size}.mp4`] : []),
      ]);
      for (const name of names)
        if (!existsSync(resolve(temp, name))) throw new CommandError(`shell capture did not produce ${name}`);
      rejectSymlinkDirectories(out);
      mkdirSync(out, { recursive: true });
      rejectSymlinkDirectories(out);
      const publish = mkdtempSync(resolve(out, '.gm-shell-publish-'));
      let preserveBackup = false;
      try {
        const backup = resolve(publish, 'previous');
        mkdirSync(backup);
        const allNames = sizes.flatMap((size) => [
          ...['play', 'menu', 'ingame', 'edit'].map((prefix) => `${prefix}-${size}.png`),
          `motion-${size}.mp4`,
        ]);
        for (const name of names) copyFileSync(resolve(temp, name), resolve(publish, name));
        const backedUp: string[] = [];
        const installed: string[] = [];
        try {
          for (const name of allNames) {
            const target = resolve(out, name);
            let entry;
            try {
              entry = lstatSync(target);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
              throw error;
            }
            if (entry.isDirectory()) throw new CommandError(`capture output is a directory: ${name}`);
            renameSync(target, resolve(backup, name));
            backedUp.push(name);
          }
          for (const name of names) {
            renameSync(resolve(publish, name), resolve(out, name));
            installed.push(name);
          }
        } catch (error) {
          try {
            for (const name of installed) rmSync(resolve(out, name), { force: true });
            for (const name of backedUp) renameSync(resolve(backup, name), resolve(out, name));
          } catch {
            preserveBackup = true;
            throw new CommandError(`could not restore earlier captures; recover them from ${backup}`);
          }
          throw error;
        }
      } finally {
        if (!preserveBackup) rmSync(publish, { recursive: true, force: true });
      }
      if (ctx.json) printJson(ctx, { out: relative(ctx.cwd, out) || '.', files: names });
      else ctx.out('App-shell captures complete (mocked sign-in; not production or Safari).');
      return EXIT.ok;
    } catch (error) {
      if (abort.signal.aborted) return 130;
      if (Date.now() >= deadline) return EXIT.timeout;
      throw new CommandError(`shell capture failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      slot?.release();
      rmSync(temp, { recursive: true, force: true });
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      rmdirSync(lock);
    }
  },
};
