import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import sharp from 'sharp';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { smallScaleIntFacts, type LockEntry, type PackFacts } from '../../scene-check/facts.js';
import { occupiedShare, type MockMeasure } from '../../scene-check/framing.js';
import { overlaySvg } from '../../scene-check/overlay.js';
import { readTiledScene, type MapSource } from '../../scene-check/read.js';
import { checkScene, reportMarkdown } from '../../scene-check/report.js';

const USAGE = 'gm verify scene games/dusk-helm graveyard --under maps/graveyard-surround.json@-8,-8 --overlay out.png';

/** Pack facts per asset set; a set without an adapter provider cannot be checked yet. */
const PACKS: Record<string, () => Promise<PackFacts>> = {
  smallscaleint: async () => smallScaleIntFacts((await import('@gm/pack-smallscaleint')) as Record<string, unknown>),
};

function readJson(path: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CommandError(`cannot read ${what} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function pair(value: string, separator: string, flag: string): [number, number] {
  const parts = value.split(separator).map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    throw new UsageError(`--${flag} needs two numbers joined by "${separator}", got "${value}"`, USAGE);
  }
  return [parts[0]!, parts[1]!];
}

function positive(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${flag} needs a positive number`, USAGE);
  return n;
}

/** A path as given (from cwd), else under the game folder, else (for a bare scene name) `maps/<name>.json`. */
function locate(cwd: string, game: string, path: string, scene = false): string {
  for (const candidate of [
    resolve(cwd, path),
    resolve(game, path),
    ...(scene ? [join(game, 'maps', `${path}.json`)] : []),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new UsageError(`no file "${path}" from here or under ${game}`, USAGE);
}

export const command: GmCommand = {
  name: 'verify scene',
  summary:
    'check a scene is structurally coherent: connected runs, closed buildings, overlap, facing, routes, placement',
  usage:
    '<game> <scene> [--under <map.json>@dx,dy] [--mock <png>] [--overlay <png>] [--out <base>] [--allow <id>] [--json]',
  example: USAGE,
  flags: {
    under: {
      type: 'string',
      multiple: true,
      help: 'a map drawn beneath the scene, at cell offset dx,dy (map.json@dx,dy)',
    },
    mock: { type: 'string', help: 'approved mock PNG; compares how much of the frame the scene fills' },
    'mock-character': { type: 'string', help: 'character height in the mock, in pixels, measured by eye' },
    'character-height': { type: 'string', help: "the game's character height on screen at zoom 1, in pixels" },
    view: { type: 'string', default: '390x844', help: 'framed camera size in screen pixels (WxH)' },
    zoom: { type: 'string', default: '1', help: 'camera zoom' },
    center: { type: 'string', help: 'camera centre cell x,y (default: the player spawn)' },
    'min-density': { type: 'string', default: '1', help: 'fewest dressing props per 10 floor cells' },
    allow: { type: 'string', multiple: true, help: 'a finding or check id listed as a known limitation; repeat' },
    overlay: { type: 'string', help: 'write a diagnostic PNG with every finding outlined and numbered' },
    out: { type: 'string', help: 'write <base>.json and <base>.md' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 2) throw new UsageError('give a game folder and a scene', USAGE);
    const game = [resolve(ctx.cwd, args[0]!), resolve(ctx.cwd, 'games', args[0]!)].find((dir) =>
      existsSync(join(dir, 'gm.lock.json')),
    );
    if (!game) throw new UsageError(`no game with a gm.lock.json at "${args[0]}"`, USAGE);
    const set = (readJson(join(game, 'gm.lock.json'), 'game lock') as { set?: string }).set ?? '';
    const load = PACKS[set];
    if (!load)
      throw new UsageError(`set "${set}" has no scene facts yet; supported: ${Object.keys(PACKS).join(', ')}`, USAGE);
    const pack = await load();
    const lockPath = join(game, 'assets.lock.json');
    // Loose read: the checker only needs ids, sources and facings, so schema drift on other fields never blocks it.
    const listed = existsSync(lockPath) ? (readJson(lockPath, 'asset list') as { assets?: unknown }).assets : undefined;
    const lock: Record<string, LockEntry> = Array.isArray(listed)
      ? Object.fromEntries((listed as (LockEntry & { id: string })[]).map((entry) => [entry.id, entry]))
      : ((listed as Record<string, LockEntry> | undefined) ?? {});
    const scenePath = locate(ctx.cwd, game, args[1]!, true);
    const sources: MapSource[] = [{ json: readJson(scenePath, 'scene') }];
    for (const [i, spec] of ((flags.under as string[] | undefined) ?? []).entries()) {
      const at = spec.lastIndexOf('@');
      if (at < 0) throw new UsageError(`--under needs map.json@dx,dy, got "${spec}"`, USAGE);
      const [x, y] = pair(spec.slice(at + 1), ',', 'under');
      sources.push({
        json: readJson(locate(ctx.cwd, game, spec.slice(0, at)), 'map'),
        offset: { x, y },
        prefix: `under${i}/`,
        under: true,
      });
    }
    let scene;
    try {
      scene = readTiledScene(sources, pack, lock);
    } catch (error) {
      throw new CommandError(
        `cannot read scene ${scenePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const [width, height] = pair(String(flags.view), 'x', 'view');
    const center = flags.center === undefined ? undefined : pair(String(flags.center), ',', 'center');
    const camera = {
      width,
      height,
      zoom: positive(flags.zoom, 'zoom')!,
      ...(center ? { center: { x: center[0], y: center[1] } } : {}),
    };
    let mock: MockMeasure | undefined;
    if (flags.mock !== undefined) {
      const image = sharp(locate(ctx.cwd, game, String(flags.mock))).ensureAlpha();
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      const character = positive(flags['mock-character'], 'mock-character');
      const characterHeight = positive(flags['character-height'], 'character-height');
      mock = {
        occupied: occupiedShare(data, info.width, info.height),
        ...(character ? { character: character / info.height } : {}),
        ...(characterHeight ? { characterHeight } : {}),
      };
    }
    const minDensity = Number(flags['min-density']);
    if (!Number.isFinite(minDensity) || minDensity < 0)
      throw new UsageError('--min-density needs a number of 0 or more', USAGE);
    const report = checkScene(basename(scenePath, '.json'), scene, {
      camera,
      minDensity,
      allow: (flags.allow as string[] | undefined) ?? [],
      ...(mock ? { mock } : {}),
    });
    const markdown = reportMarkdown(report);
    if (flags.out !== undefined) {
      const base = resolve(ctx.cwd, String(flags.out));
      await mkdir(dirname(base), { recursive: true });
      await writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(`${base}.md`, markdown);
    }
    if (flags.overlay !== undefined) {
      const path = resolve(ctx.cwd, String(flags.overlay));
      await mkdir(dirname(path), { recursive: true });
      await sharp(Buffer.from(overlaySvg(scene, report)))
        .png()
        .toFile(path);
    }
    if (ctx.json) printJson(ctx, report);
    else for (const line of markdown.trimEnd().split('\n')) ctx.out(line);
    ctx.emit('verify.scene', { scene: report.scene, pass: report.pass, counts: report.counts });
    return report.pass ? EXIT.ok : EXIT.failed;
  },
};
