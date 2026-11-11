import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
    crop: { type: 'string', help: 'target crop in pixels' },
    region: { type: 'string', multiple: true, help: 'named region in normalized pixels' },
    out: { type: 'string', help: 'output sheet path' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 2) throw new UsageError('provide target and candidate images', 'gm help look score');
    const target = resolve(ctx.cwd, args[0]!),
      candidate = resolve(ctx.cwd, args[1]!);
    const a = await image(target, typeof flags.crop === 'string' ? rect(flags.crop) : undefined);
    const b = await resize(candidate, a.width, a.height);
    const regions = (Array.isArray(flags.region) ? (flags.region as string[]) : []).map((entry) => {
      const at = entry.indexOf('=');
      if (at < 1) throw new UsageError('region needs name=x,y,w,h', 'gm help look score');
      const bounds = rect(entry.slice(at + 1));
      if (bounds.x + bounds.w > a.width || bounds.y + bounds.h > a.height)
        throw new UsageError('region exceeds image bounds', 'gm help look score');
      return { name: entry.slice(0, at), bounds, ...metrics(a, b, bounds) };
    });
    const output = resolve(ctx.cwd, typeof flags.out === 'string' ? flags.out : 'look-score.png');
    if (output === target || output === candidate)
      throw new UsageError('output must not overwrite an input', 'choose a different --out path');
    await sheet(a, b, output);
    const digest = async (path: string) =>
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    await writeFile(
      `${output}.json`,
      JSON.stringify({
        target,
        candidate,
        sheet: output,
        hashes: await Promise.all([target, candidate, output].map(digest)),
      }),
    );
    ctx.out(
      JSON.stringify({
        target,
        candidate,
        sheet: output,
        overall: metrics(a, b, { x: 0, y: 0, w: a.width, h: a.height }),
        regions,
        worstRegions: [...regions].sort((x, y) => x.ssim - y.ssim).slice(0, 5),
        perceptual: await perceptual(a, b),
      }),
    );
    return EXIT.ok;
  },
};
