import type { AssetCard, PlacementResult, Pose } from '@ogm/contracts';

import { layerForCategory, type Layer } from './conventions.js';
import { IsoMap, worldToIso } from './map.js';

const CATEGORY_ORDER = [
  'WallFlora',
  'Ground',
  'Wall',
  'Door',
  'Roof',
  'Misc',
  'Stone',
  'Tree',
  'Flora',
  'Chest',
] as const;
const HIDDEN_CATEGORIES = new Set<string>(['Ground', 'Roof']);
const EPSILON = 1e-6;

export type PaletteCategory = (typeof CATEGORY_ORDER)[number];
export type PlacementKind = 'cell' | 'edge';

export interface PalettePrefab {
  prefab: string;
  label: string;
  category: PaletteCategory;
  layer: Layer;
  footprint: readonly [1, 1];
  placement: PlacementKind;
}

export function categoryFrom(text: string): PaletteCategory | undefined {
  const words = text.toLowerCase();
  if (/(?:^|[^a-z])wall[-_ ]?flora(?:[^a-z]|$)/.test(words)) return 'WallFlora';
  return CATEGORY_ORDER.find((category) => new RegExp(`(?:^|[^a-z])${category.toLowerCase()}(?:[^a-z]|$)`).test(words));
}

export function categoryOf(card: AssetCard): PaletteCategory | undefined {
  return categoryFrom(`${card.title} ${card.id}`);
}

export function placementOf(category: PaletteCategory): PlacementKind {
  return category === 'Wall' || category === 'Door' ? 'edge' : 'cell';
}

/** Four-facing iso tile cards grouped by measured category, in category order and sorted by id. */
export function cardsByCategory(
  cards: readonly AssetCard[],
  hidden: ReadonlySet<string> = HIDDEN_CATEGORIES,
): [PaletteCategory, AssetCard[]][] {
  const groups: [PaletteCategory, AssetCard[]][] = [];
  const seen = new Set<string>();
  for (const category of CATEGORY_ORDER) {
    if (hidden.has(category)) continue;
    const items: AssetCard[] = [];
    for (const card of cards) {
      if (
        seen.has(card.id) ||
        card.card_type !== 'asset' ||
        card.sprite?.drawn_view !== 'iso' ||
        !card.sprite.tile?.layer
      ) {
        continue;
      }
      if (!(['E', 'N', 'S', 'W'] as const).every((facing) => card.sprite?.facings?.[facing])) continue;
      if (categoryOf(card) !== category) continue;
      seen.add(card.id);
      items.push(card);
    }
    items.sort((a, b) => a.id.localeCompare(b.id));
    if (items.length > 0) groups.push([category, items]);
  }
  return groups;
}

/** Placeable four-facing cards grouped by the category measured from the SmallScaleInt file names. */
export function paletteFrom(cards: readonly AssetCard[]): Partial<Record<PaletteCategory, PalettePrefab[]>> {
  const groups: Partial<Record<PaletteCategory, PalettePrefab[]>> = {};
  for (const [category, items] of cardsByCategory(cards)) {
    groups[category] = items.map((card) => ({
      prefab: card.id,
      label: card.title,
      category,
      layer: layerForCategory(category),
      footprint: [1, 1],
      placement: placementOf(category),
    }));
  }
  return groups;
}

function centred(value: number): boolean {
  return Math.abs(value - Math.round(value)) < EPSILON;
}

function onHalf(value: number): boolean {
  return Math.abs(value - (Math.floor(value) + 0.5)) < EPSILON;
}

/** Checks the adapter's geometry only; overlap and game-specific placement rules remain game-owned. */
export function validatePlacement(prefab: string, pose: Pose, map: IsoMap): PlacementResult {
  const category = categoryFrom(prefab);
  if (!category || HIDDEN_CATEGORIES.has(category)) return { ok: false, reason: 'unknown prefab' };
  const [worldX, worldY] = pose.position;
  const { x, y } = worldToIso(worldX, worldY);
  if (placementOf(category) === 'cell') {
    if (!centred(x) || !centred(y)) return { ok: false, reason: 'prefab must be centred on a floor tile' };
    return map.hasFloor(Math.round(x), Math.round(y)) ? { ok: true } : { ok: false, reason: 'outside map floor' };
  }

  let neighbours: [number, number][];
  if (centred(x) && onHalf(y)) {
    neighbours = [
      [Math.round(x), Math.floor(y)],
      [Math.round(x), Math.ceil(y)],
    ];
  } else if (onHalf(x) && centred(y)) {
    neighbours = [
      [Math.floor(x), Math.round(y)],
      [Math.ceil(x), Math.round(y)],
    ];
  } else {
    return { ok: false, reason: 'wall prefabs must be centred on a grid edge' };
  }
  return neighbours.some(([tileX, tileY]) => map.hasFloor(tileX, tileY))
    ? { ok: true }
    : { ok: false, reason: 'outside map floor' };
}
