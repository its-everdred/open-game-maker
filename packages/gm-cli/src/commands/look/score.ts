import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { judgeCacheKey } from './judge.js';
import sharp from 'sharp';
import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { image, metrics, resize, sheet, type Rect } from '../../look/score.js';
import { perceptual } from '../../look/perceptual.js';

function rect(value: string): Rect {
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0) || !parts[2] || !parts[3])
    throw new UsageError('rectangle must be x,y,w,h in pixels', 'gm help look score');
  return { x: parts[0]!, y: parts[1]!, w: parts[2]!, h: parts[3]! };
}
export const command: GmCommand = {
  name: 'look score',
  summary: 'compare a candidate image with a concept locally',
  usage: '<target.png> <candidate.png> [--crop x,y,w,h] [--region name=x,y,w,h] [--out sheet.png]',
  flags: {
    crop: { type: 'string', help: 'crop both inputs in pixels' },
    region: { type: 'string', multiple: true, help: 'named region in normalized pixels' },
    out: { type: 'string', help: 'output sheet path' },
    perceptual: { type: 'string', help: 'local LPIPS adapter executable' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 2) throw new UsageError('provide target and candidate images', 'gm help look score');
    const [target, candidate] = await Promise.all([
      realpath(resolve(ctx.cwd, args[0]!)),
      realpath(resolve(ctx.cwd, args[1]!)),
    ]);
    const crop = typeof flags.crop === 'string' ? rect(flags.crop) : undefined;
    const [targetBytes, candidateBytes] = await Promise.all([readFile(target), readFile(candidate)]);
    const a = await image(targetBytes, crop);
    const dimensions = await sharp(targetBytes).metadata();
    if (!dimensions.width || !dimensions.height) throw new Error('target dimensions unavailable');
    const b = await resize(candidateBytes, dimensions.width, dimensions.height, crop);
    const named = (Array.isArray(flags.region) ? (flags.region as string[]) : []).map((entry) => {
      const at = entry.indexOf('=');
      if (at < 1) throw new UsageError('region needs name=x,y,w,h', 'gm help look score');
      const bounds = rect(entry.slice(at + 1));
      if (bounds.x + bounds.w > a.width || bounds.y + bounds.h > a.height)
        throw new UsageError('region exceeds image bounds', 'gm help look score');
      return { name: entry.slice(0, at), bounds, ...metrics(a, b, bounds) };
    });
    const rows = Math.min(3, a.height),
      cols = Math.min(3, a.width);
    const regions = named.length
      ? named
      : Array.from({ length: rows }, (_, row) =>
          Array.from({ length: cols }, (_, col) => {
            const x = Math.floor((col * a.width) / cols),
              y = Math.floor((row * a.height) / rows);
            const bounds = {
              x,
              y,
              w: Math.floor(((col + 1) * a.width) / cols) - x,
              h: Math.floor(((row + 1) * a.height) / rows) - y,
            };
            return { name: `row${row + 1}-col${col + 1}`, bounds, ...metrics(a, b, bounds) };
          }),
        ).flat();
    const output = resolve(ctx.cwd, typeof flags.out === 'string' ? flags.out : 'look-score.png');
    const sourceStats = await Promise.all([stat(target), stat(candidate)]);
    for (const destination of [output, `${output}.json`]) {
      const outputStat = await stat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (
        destination === target ||
        destination === candidate ||
        (outputStat && sourceStats.some((source) => source.dev === outputStat.dev && source.ino === outputStat.ino))
      )
        throw new UsageError('output must not overwrite an input', 'choose a different --out path');
    }
    const sheetBytes = await sheet(a, b);
    await writeFile(output, sheetBytes);
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const hashes = [digest(targetBytes), digest(candidateBytes), digest(sheetBytes)];
    await writeFile(
      `${output}.json`,
      JSON.stringify({
        target,
        candidate,
        sheet: output,
        crop: crop ?? null,
        hashes,
      }),
    );
    let root: string | null = null;
    try {
      root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: ctx.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      /* scoring also works outside a workspace */
    }
    const cached =
      root === null
        ? null
        : await readFile(join(root, '.gm-mock', 'judge', `verdict-${judgeCacheKey(hashes)}.json`), 'utf8').catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return null;
              throw error;
            },
          );
    const judgeSpread: unknown = cached === null ? null : (JSON.parse(cached) as { spread: unknown }).spread;
    ctx.out(
      JSON.stringify({
        judge_spread: judgeSpread,
        target,
        candidate,
        sheet: output,
        overall: metrics(a, b, { x: 0, y: 0, w: a.width, h: a.height }),
        regions,
        worstRegions: [...regions].sort((x, y) => x.ssim - y.ssim).slice(0, 5),
        perceptual: await perceptual(
          a,
          b,
          typeof flags.perceptual === 'string' ? resolve(ctx.cwd, flags.perceptual) : undefined,
        ),
      }),
    );
    return EXIT.ok;
  },
};
