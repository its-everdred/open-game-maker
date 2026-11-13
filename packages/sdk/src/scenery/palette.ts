import type { GameManifest } from '@ogm/contracts';

export type SceneryPaletteItem = {
  assetId: string;
  name: string;
  category: 'trees' | 'rocks' | 'water' | 'props';
  thumbnail?: string;
  tag?: string;
};

/** Palette data for the shared editor; only items in the game's lock may be offered. */
export function sceneryPalette(
  items: readonly SceneryPaletteItem[],
  assets: readonly { id: string }[],
): GameManifest['palette'] {
  const locked = new Set(assets.map((asset) => asset.id));
  const categories: GameManifest['palette']['categories'] = [
    { id: 'trees', label: 'Trees', kind: 'items' },
    { id: 'rocks', label: 'Rocks', kind: 'items' },
    { id: 'water', label: 'Water', kind: 'items' },
    { id: 'props', label: 'Props', kind: 'items' },
    { id: 'light', label: 'Light', kind: 'panel' },
  ];
  return {
    categories,
    items: items
      .filter((item) => locked.has(item.assetId))
      .map((item) => ({
        prefab: `scenery:${item.assetId}`,
        label: item.name,
        category: item.category,
        ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}),
        ...(item.tag ? { tag: item.tag } : {}),
      })),
  };
}
