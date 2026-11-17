import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
import { findPlayAreaConfig } from '../../play-area-config.js';

const sizes = ['390x844', '844x390', '820x1180', '1180x820'];

/** Honor explicitly selected symlinked roots (such as assets-local) while checking the resolved path. */
function outputPath(path: string): string {
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  return resolve(realpathSync(ancestor), relative(ancestor, path));
}

export function captureScratch(cwd: string, base = tmpdir()): { path: string; local: boolean } {
  try {
    return { path: mkdtempSync(resolve(base, 'gm-look-shell-')), local: false };
  } catch (error) {
    if (!['EACCES', 'EROFS', 'ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    try {
      return { path: mkdtempSync(resolve(cwd, '.gm-look-shell-')), local: true };
    } catch (cause) {
      throw new CommandError(
        `cannot create shell capture scratch directory: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
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
    'min-fill': { type: 'string', help: 'minimum board height fraction' },
    'max-offset': { type: 'string', help: 'maximum horizontal offset fraction' },
  },
  async run(ctx, args, flags) {
    if (args.length || typeof flags.dist !== 'string' || typeof flags.out !== 'string')
      throw new UsageError('dist and out paths are required', 'gm help look shell');
    const timeout = flags.timeout as number;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new UsageError('invalid timeout', 'gm help look shell');
    const config = findPlayAreaConfig(resolve(ctx.cwd, flags.dist));
    const minFill = flags['min-fill'] ?? (config === false ? undefined : config.minFill);
    const maxOffset = flags['max-offset'] ?? (config === false ? undefined : config.maxOffset);
    const limits = {
      ...(minFill === undefined ? {} : { minFill: Number(minFill) }),
      ...(maxOffset === undefined ? {} : { maxOffset: Number(maxOffset) }),
      skip: config === false,
    };
    if (
      [limits.minFill, limits.maxOffset].some(
        (value) => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1),
      )
    )
      throw new UsageError('invalid play-area limits', 'gm help look shell');
    const tap = flags.tap ?? (config === false ? undefined : config.tap);
    const taps = typeof tap === 'string' ? tap.split('>').map((text) => text.trim()) : [];
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
    const { path: temp, local: localTemp } = captureScratch(ctx.cwd);
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
    let stage = 'waiting for a capture slot';
    try {
      const { acquireSlot } = await import('@ogm/gm-verify');
      const slotOptions = { waitMs: Math.min(timeout * 1000, 600_000), signal: abort.signal };
      const workspaceRuntime = resolve(ctx.cwd, '.gm-verify-runtime');
      let runtimeDir = ctx.config.runtimeDir ?? (localTemp ? workspaceRuntime : undefined);
      if (localTemp && ctx.config.runtimeDir) {
        try {
          const root = resolve(ctx.config.runtimeDir, 'ogm-verify');
          mkdirSync(root, { recursive: true });
          rmdirSync(mkdtempSync(resolve(root, '.probe-')));
        } catch (error) {
          if (!['EACCES', 'EROFS', 'ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
            throw error;
          runtimeDir = workspaceRuntime;
        }
      }
      try {
        slot = await acquireSlot({
          ...slotOptions,
          runtimeDir,
        });
      } catch (error) {
        if (
          !localTemp ||
          !ctx.config.runtimeDir ||
          !['EACCES', 'EROFS', 'ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
        )
          throw error;
        slot = await acquireSlot({ ...slotOptions, runtimeDir: workspaceRuntime });
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        ctx.err('shell capture timed out while waiting for a capture slot');
        return EXIT.timeout;
      }
      const runner = fileURLToPath(import.meta.resolve('@ogm/gm-verify/app-capture'));
      stage = 'running the browser';
      const runCapture = (software: boolean, remainingMs: number) =>
        runChild(
          ctx.cwd,
          [
            runner,
            dist,
            temp,
            JSON.stringify(taps),
            flags.edit ? '1' : '0',
            flags.mp4 ? '1' : '0',
            software ? '1' : '0',
            '',
            JSON.stringify(limits),
          ],
          localTemp ? { ...ctx.env, TMPDIR: temp } : (ctx.env ?? {}),
          remainingMs,
          abort.signal,
          process.execPath,
          ctx.json,
        );
      let result = await runCapture(ctx.config.verifySoftwareGl, remaining);
      if (result === 42 && !ctx.config.verifySoftwareGl && !abort.signal.aborted) {
        ctx.err('shell capture: GPU screenshot stalled; retrying all views with SwiftShader');
        rmSync(temp, { recursive: true, force: true });
        mkdirSync(temp, { recursive: true });
        const retryRemaining = deadline - Date.now();
        result = retryRemaining > 0 ? await runCapture(true, retryRemaining) : EXIT.timeout;
      }
      if (result === 42) result = EXIT.timeout;
      if (result !== 0) {
        ctx.err(
          result === EXIT.timeout
            ? 'shell capture timed out while running the browser'
            : `shell capture runner exited with code ${result}`,
        );
        return result;
      }
      const measurements = JSON.parse(readFileSync(resolve(temp, 'play-area.json'), 'utf8')) as {
        viewport: string;
        fill?: number;
        offset?: number;
        ok: boolean;
        error?: string;
      }[];
      const distortions = JSON.parse(readFileSync(resolve(temp, 'image-distortion.json'), 'utf8')) as {
        element: string;
        file: string;
        natural: number;
        drawn: number;
        viewport: string;
        screen: string;
      }[];
      if (
        !limits.skip &&
        (measurements.length !== sizes.length || measurements.some((item, index) => item.viewport !== sizes[index]))
      )
        throw new CommandError('shell capture did not measure every viewport');
      stage = 'publishing stills';
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
      if (ctx.json)
        printJson(ctx, { out: relative(ctx.cwd, out) || '.', files: names, playArea: measurements, distortions });
      else {
        ctx.out('App-shell captures complete (mocked sign-in; not production or Safari).');
        for (const item of measurements)
          ctx.out(
            item.error
              ? `play area: ${item.error.includes('not declared') ? 'not declared' : item.error} at ${item.viewport}: fail`
              : `board fill ${item.fill!.toFixed(2)} at ${item.viewport}, offset ${item.offset!.toFixed(2)}: ${item.ok ? 'pass' : 'fail'}`,
          );
        for (const item of distortions)
          ctx.out(
            `image distortion: ${item.element} ${item.file} natural ${item.natural.toFixed(3)} drawn ${item.drawn.toFixed(3)} at ${item.viewport} (${item.screen}): fail`,
          );
      }
      return EXIT.ok;
    } catch (error) {
      if (abort.signal.aborted) return 130;
      if (Date.now() >= deadline) {
        ctx.err(`shell capture timed out while ${stage}`);
        return EXIT.timeout;
      }
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
