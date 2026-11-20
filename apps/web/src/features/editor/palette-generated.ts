import type { GameManifest } from '@ogm/contracts/browser';

type Palette = GameManifest['palette'];

/** Annotate native items only when the game's locked catalog identifies the same asset. */
export function annotateGeneratedPalette(native: Palette, catalog: Palette | undefined): Palette {
  const made = new Set((catalog?.items ?? []).filter((item) => item.madeByGameMaker).map((item) => item.prefab));
  return {
    ...native,
    items: native.items.map((item) =>
      made.has(item.prefab) || (typeof item.assetId === 'string' && made.has(item.assetId))
        ? { ...item, madeByGameMaker: true }
        : item,
    ),
  };
}
