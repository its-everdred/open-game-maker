import { createHash } from 'node:crypto';

export { renderCollectionSheet, type CollectionSheetResult } from './collection.js';
export { VIEWS, type View } from './page.js';
export { renderSheet, type RenderSheetOptions, type RenderSheetResult } from './sheet.js';
export { spriteSheet, type SpriteSheetOptions } from './sprite.js';

export type Redistribution = 'free' | 'in-build' | 'none' | string | undefined;

export function previewKey(
  sourceHash: string,
  kind: string,
  redistribution: Redistribution,
  parameters: Record<string, string | number | boolean> = {},
): string {
  const prefix = redistribution === 'free' || redistribution === 'in-build' ? 'previews' : 'private/previews';
  const stableParameters = Object.fromEntries(
    Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)),
  );
  const digest = createHash('sha256')
    .update(JSON.stringify({ sourceHash, kind, parameters: stableParameters }))
    .digest('hex');
  return `${prefix}/${digest.slice(0, 2)}/${digest.slice(0, 16)}-${kind}.webp`;
}
