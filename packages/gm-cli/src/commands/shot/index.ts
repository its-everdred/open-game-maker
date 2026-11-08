import { readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';

export const STILL = /^t\d+(?:\.\d+)?\.png$/;
const numeric = new Intl.Collator('en', { numeric: true });

/** Finds only captured stills (`tN.png`), recursively; timelines and existing sheets are never tiled back in. */
export function findStills(root: string, dir = root): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findStills(root, path));
    else if (entry.isFile() && STILL.test(entry.name)) found.push(path);
  }
  return found.sort((a, b) => numeric.compare(relative(root, a), relative(root, b)));
}

export const command: GmCommand = {
  name: 'shot',
  summary: 'tile captured tN.png stills into one sheet.png',
  usage: '--sheet shots/ [--out sheet.png]',
  example: 'shot --sheet shots/',
  flags: {
    sheet: { type: 'string', help: 'directory containing captured stills' },
    out: { type: 'string', help: 'output PNG; defaults inside --sheet' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help shot');
    if (typeof flags.sheet !== 'string') throw new UsageError('--sheet is required', 'gm shot --sheet shots/');
    const root = resolve(ctx.cwd, flags.sheet);
    let files: string[];
    try {
      files = findStills(root);
    } catch {
      throw new UsageError(`sheet directory does not exist: ${flags.sheet}`, 'gm shot --sheet shots/');
    }
    if (files.length === 0) throw new UsageError('no t*.png stills found', 'gm run --frames 0,2,5 --out shots/');
    const out = resolve(ctx.cwd, typeof flags.out === 'string' ? flags.out : join(root, 'sheet.png'));
    const verify = await import('@ogm/gm-verify');
    try {
      verify.tile(files, out);
    } catch (error) {
      if (error instanceof verify.FfmpegMissingError) throw new UsageError(error.message, verify.FFMPEG_HINT);
      ctx.err(error instanceof Error ? error.message : String(error));
      return EXIT.failed;
    }
    const shown = relative(ctx.cwd, out) || basename(out);
    if (ctx.json) printJson(ctx, { out: shown, cells: files.length });
    else ctx.out(`wrote ${shown} (${files.length} stills)`);
    return EXIT.ok;
  },
};
