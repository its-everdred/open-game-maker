import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  usage: '<reference.png> <render.png> <registration.json>',
  flags: {},
  async run(ctx, args) {
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
    ctx.out(
      JSON.stringify(
        {
          referenceSha256: hash(referenceBytes!),
          renderSha256: hash(renderBytes!),
          registrationSha256: hash(registrationBytes!),
          regions,
        },
        null,
        2,
      ),
    );
    return EXIT.ok;
  },
};
