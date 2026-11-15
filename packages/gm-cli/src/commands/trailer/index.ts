import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { gameDir, workspaceRoot } from '../../outbox.js';

export const command: GmCommand = {
  name: 'trailer',
  summary: 'capture scripted gameplay with game audio in portrait and landscape',
  usage: '<game> --script scenarios.json --out directory',
  example: 'trailer blobs --script trailer.json --out media/',
  flags: {
    script: { type: 'string', help: 'JSON array of named scenarios, durations and timed inputs' },
    out: { type: 'string', help: 'output directory for both MP4 files' },
    fps: { type: 'number', default: 30, help: 'output frame rate from 1 to 60' },
    gpu: { type: 'boolean', default: false, help: 'use the GPU instead of software rendering' },
  },
  async run(ctx, args, flags) {
    const [name] = args;
    if (args.length !== 1 || !name || !/^[a-z0-9][a-z0-9_-]*$/.test(name))
      throw new UsageError('a game id is required', 'gm trailer <game> --script scenarios.json --out media/');
    if (typeof flags.script !== 'string' || typeof flags.out !== 'string')
      throw new UsageError('--script and --out are required', 'gm trailer <game> --script scenarios.json --out media/');
    if (typeof flags.fps !== 'number' || !Number.isInteger(flags.fps) || flags.fps < 1 || flags.fps > 60)
      throw new UsageError(
        '--fps must be an integer from 1 to 60',
        'gm trailer <game> --script scenarios.json --out media/',
      );
    const root = workspaceRoot(ctx.cwd);
    const candidate = join(root, 'games', name);
    const game = existsSync(join(candidate, 'gm.manifest.json')) ? candidate : gameDir(ctx.cwd, root);
    let manifest: { id?: string };
    try {
      manifest = JSON.parse(readFileSync(join(game, 'gm.manifest.json'), 'utf8')) as { id?: string };
    } catch {
      throw new UsageError(`game ${name} was not found`, 'run in the game workspace or its repository');
    }
    if (manifest.id !== name) throw new UsageError(`game ${name} was not found`, 'use the game manifest id');
    const verify = await import('@ogm/gm-verify');
    let script: ReturnType<typeof verify.trailerScriptSchema.parse>;
    try {
      script = verify.trailerScriptSchema.parse(JSON.parse(readFileSync(resolve(ctx.cwd, flags.script), 'utf8')));
    } catch (error) {
      throw new UsageError(
        `invalid trailer script: ${error instanceof Error ? error.message : String(error)}`,
        'check the scenario list',
      );
    }
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
