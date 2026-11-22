import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { image } from '../../look/score.js';
import { rankRegisteredRegions } from '../../scene/rank-registered.js';
import { fitGroundPlane } from '../../scene/registration.js';
import { warpNearest } from '../../scene/warp.js';

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const input = z
  .object({
    anchors: z.array(z.object({ reference: point, render: point }).strict()).length(4),
    regions: z
      .array(
        z
          .object({
            id: z.string().min(1),
            bounds: z
              .object({ x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int() })
              .strict(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const command: GmCommand = {
  name: 'scene compare-ground',
  summary: 'rank registered ground-plane image differences',
  usage: '<reference.png> <render.png> <registration.json> [--out sheet.png]',
  flags: { out: { type: 'string', help: 'write a new comparison sheet without overwriting files' } },
  async run(ctx, args, flags) {
    if (args.length !== 3)
      throw new UsageError('provide reference, render and registration files', 'gm help scene compare-ground');
    const [referenceBytes, renderBytes, registrationBytes] = await Promise.all(
      args.map((path) => readFile(resolve(ctx.cwd, path))),
    );
    const registration = input.parse(JSON.parse(registrationBytes!.toString()));
    const reference = await image(referenceBytes!);
    const { data, info } = await sharp(renderBytes!)
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      registration.anchors.some(
        ({ reference: a, render: b }) =>
          a.x < 0 ||
          a.y < 0 ||
          a.x >= reference.width ||
          a.y >= reference.height ||
          b.x < 0 ||
          b.y < 0 ||
          b.x >= info.width ||
          b.y >= info.height,
      )
    )
      throw new Error('registration anchor is outside its image');
    const transform = fitGroundPlane(
      registration.anchors.map(({ reference: ground, render: image }) => ({ ground, image })),
    );
    const warped = warpNearest(
      { width: info.width, height: info.height, pixels: data },
      reference.width,
      reference.height,
      transform,
    );
    const regions = rankRegisteredRegions(reference, warped, registration.regions);
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    let sheet: { path: string; sha256: string } | null = null;
    if (typeof flags.out === 'string') {
      const pixels = Buffer.alloc(reference.width * reference.height * 9);
      for (let y = 0; y < reference.height; y++) {
        for (let x = 0; x < reference.width; x++) {
          const index = y * reference.width + x;
          const source = index * 3;
          const render = index * 4;
          const row = y * reference.width * 9;
          for (let channel = 0; channel < 3; channel++) {
            const a = reference.pixels[source + channel]!;
            const b = warped.pixels[render + 3] === 255 ? warped.pixels[render + channel]! : channel === 1 ? 0 : 255;
            pixels[row + x * 3 + channel] = a;
            pixels[row + (reference.width + x) * 3 + channel] = b;
            pixels[row + (2 * reference.width + x) * 3 + channel] = Math.round((a + b) / 2);
          }
        }
      }
      const png = await sharp(pixels, { raw: { width: reference.width * 3, height: reference.height, channels: 3 } })
        .png()
        .toBuffer();
      const path = resolve(ctx.cwd, flags.out);
      await writeFile(path, png, { flag: 'wx' });
      sheet = { path, sha256: hash(png) };
    }
    ctx.out(
      JSON.stringify(
        {
          referenceSha256: hash(referenceBytes!),
          renderSha256: hash(renderBytes!),
          registrationSha256: hash(registrationBytes!),
          sheet,
          regions,
        },
        null,
        2,
      ),
    );
    return EXIT.ok;
  },
};
