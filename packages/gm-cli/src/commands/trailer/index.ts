import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gameMenusSchema } from '@ogm/contracts';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { gameDir, workspaceRoot } from '../../outbox.js';

export const command: GmCommand = {
  name: 'trailer',
  summary: 'capture the 16:9 gameplay trailer with game audio, or check it against the trailer standard',
  usage: '<game> --script scenarios.json --out directory | <game> --check [--dir directory]',
  example: 'trailer blobs --script trailer.json --out public/media/',
  flags: {
    script: { type: 'string', help: 'JSON array of named scenarios, durations and timed inputs' },
    out: { type: 'string', help: 'output directory for the trailer and its frame record' },
    check: { type: 'boolean', default: false, help: 'check the published trailer instead of capturing one' },
    dir: { type: 'string', help: "media directory to check (default: the game's public/media)" },
    fps: { type: 'number', default: 30, help: 'output frame rate from 1 to 60' },
    gpu: { type: 'boolean', default: false, help: 'use the GPU instead of software rendering' },
  },
  async run(ctx, args, flags) {
    const [name] = args;
    if (args.length !== 1 || !name || !/^[a-z0-9][a-z0-9_-]*$/.test(name))
      throw new UsageError('a game id is required', 'gm trailer <game> --script scenarios.json --out media/');
    if (flags.check === true && (flags.script !== undefined || flags.out !== undefined))
      throw new UsageError('--check does not capture', 'gm trailer <game> --check --dir public/media/');
    if (flags.check !== true && flags.dir !== undefined)
      throw new UsageError('--dir only applies to --check', 'gm trailer <game> --check --dir public/media/');
    const root = workspaceRoot(ctx.cwd);
    const candidate = join(root, 'games', name);
    const game = existsSync(join(candidate, 'gm.manifest.json')) ? candidate : gameDir(ctx.cwd, root);
    let manifest: { id?: string; menus?: unknown };
    try {
      manifest = JSON.parse(readFileSync(join(game, 'gm.manifest.json'), 'utf8')) as typeof manifest;
    } catch {
      throw new UsageError(`game ${name} was not found`, 'run in the game workspace or its repository');
    }
    if (manifest.id !== name) throw new UsageError(`game ${name} was not found`, 'use the game manifest id');
    const parsedMenus = gameMenusSchema.safeParse(manifest.menus ?? {});
    if (!parsedMenus.success)
      throw new UsageError(
        `invalid menus in gm.manifest.json: ${parsedMenus.error.message}`,
        'list menu CSS selectors in menus.selectors and menu routes in menus.routes',
      );
    const menus = { selectors: parsedMenus.data.selectors ?? [], routes: parsedMenus.data.routes ?? [] };
    const verify = await import('@ogm/gm-verify');
    if (flags.check === true) {
      const dir = typeof flags.dir === 'string' ? resolve(ctx.cwd, flags.dir) : join(game, 'public', 'media');
      let failures: string[];
      try {
        failures = verify.checkTrailer(dir, menus);
      } catch (error) {
        if (error instanceof verify.FfmpegMissingError)
          throw new UsageError('ffprobe is not installed', 'install ffmpeg, for example: sudo apt-get install ffmpeg');
        throw error;
      }
      if (ctx.json) printJson(ctx, { ok: failures.length === 0, failures });
      else if (failures.length) for (const failure of failures) ctx.err(failure);
      else ctx.out(`${verify.TRAILER_FILE} meets the trailer standard`);
      return failures.length ? EXIT.failed : EXIT.ok;
    }
    if (typeof flags.script !== 'string' || typeof flags.out !== 'string')
      throw new UsageError('--script and --out are required', 'gm trailer <game> --script scenarios.json --out media/');
    if (typeof flags.fps !== 'number' || !Number.isInteger(flags.fps) || flags.fps < 1 || flags.fps > 60)
      throw new UsageError(
        '--fps must be an integer from 1 to 60',
        'gm trailer <game> --script scenarios.json --out media/',
      );
    let script: ReturnType<typeof verify.trailerScriptSchema.parse>;
    try {
      script = verify.trailerScriptSchema.parse(JSON.parse(readFileSync(resolve(ctx.cwd, flags.script), 'utf8')));
    } catch (error) {
      throw new UsageError(
        `invalid trailer script: ${error instanceof Error ? error.message : String(error)}`,
        'check the scenario list',
      );
    }
    const fps = flags.fps;
    if (script.some((scene) => Math.abs(scene.seconds * fps - Math.round(scene.seconds * fps)) > 1e-7))
      throw new UsageError('scenario durations must align to the frame rate', 'check --fps and scenario durations');
    const build = mkdtempSync(join(tmpdir(), 'gm-trailer-build-'));
    try {
      execFileSync('pnpm', ['run', 'build', '--mode', 'test', '--outDir', build], {
        cwd: game,
        stdio: ctx.json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      });
      const paths = await verify.captureTrailer({
        fps: typeof flags.fps === 'number' ? flags.fps : 30,
        serveDir: build,
        outDir: resolve(ctx.cwd, flags.out),
        script,
        menus,
        software: flags.gpu !== true,
        slots: { runtimeDir: ctx.config.runtimeDir },
      });
      if (ctx.json) printJson(ctx, { paths });
      else for (const path of paths) ctx.out(`wrote ${path}`);
      return EXIT.ok;
    } finally {
      rmSync(build, { recursive: true, force: true });
    }
  },
};
