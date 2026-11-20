import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { IMAGE_SLOTS, VIEWPORTS, type ReviewSubmission, type ViewportId } from '@ogm/contracts';
import sharp from 'sharp';

const BACKGROUND = '#0f0e16';
const SCALE = 2;
const ORDER: readonly ViewportId[] = [
  'phone-portrait',
  'phone-landscape',
  'tablet-portrait',
  'tablet-landscape',
  'desktop',
];

type Still = Extract<ReviewSubmission['media'][number], { kind: 'still' }>;

export async function buildComposites(
  stills: readonly Still[],
  root: string,
): Promise<{ viewport: ViewportId; path: string }[]> {
  const eligible = stills
    .map((still, index) => ({ still, index }))
    .filter(
      (entry): entry is { still: Still & { slot: keyof typeof IMAGE_SLOTS }; index: number } => Boolean(entry.still.slot),
    );
  const output = join(root, 'review', 'composites');
  await mkdir(output, { recursive: true });
  const composites: { viewport: ViewportId; path: string }[] = [];

  for (const { still, index } of eligible) {
    const input = `still-${index + 1}`;
    const viewports = still.viewport ? [still.viewport] : IMAGE_SLOTS[still.slot].viewports;
    for (const viewport of viewports) {
      const canvas = VIEWPORTS[viewport];
      const box = IMAGE_SLOTS[still.slot].display[viewport];
      const width = Math.round(box.width * SCALE);
      const height = Math.round(box.height * SCALE);
      const image = await sharp(still.ref.replace(/^file:/u, ''))
        .resize(width, height, { fit: 'fill' })
        .png()
        .toBuffer();
      const file = join(output, `${String(index + 1).padStart(2, '0')}-${viewport}-${input}.png`);
      await sharp({
        create: {
          width: canvas.width * SCALE,
          height: canvas.height * SCALE,
          channels: 4,
          background: BACKGROUND,
        },
      })
        .composite([
          {
            input: image,
            left: Math.round((canvas.width * SCALE - width) / 2),
            top: Math.round((canvas.height * SCALE - height) / 2),
          },
        ])
        .png()
        .toFile(file);
      composites.push({ viewport, path: file });
    }
  }
  return composites.sort((a, b) => ORDER.indexOf(a.viewport) - ORDER.indexOf(b.viewport));
}
