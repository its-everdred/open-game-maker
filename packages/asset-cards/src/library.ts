import type { EditorLibrary, EditorLibraryItem } from '@ogm/contracts';

import { packOf } from './families.js';
import { statusAllowed } from './search.js';
import type { CardIndex, ResolvedCard } from './types.js';

/** Kind chips in the order the map maker shows them (Kevin's approved browse sheet, #1191). */
const GROUPS = [
  { id: 'ground', label: 'Ground' },
  { id: 'fences', label: 'Fences' },
  { id: 'walls', label: 'Walls' },
  { id: 'doors', label: 'Doors' },
  { id: 'roofs', label: 'Roofs' },
  { id: 'nature', label: 'Nature' },
  { id: 'props', label: 'Props' },
  { id: 'characters', label: 'Characters' },
  { id: 'effects', label: 'Effects' },
] as const;

type GroupId = (typeof GROUPS)[number]['id'];

/** Words that place a card in a group, tried in this order (a wall vine is nature, a garden gate is a fence). */
const GROUP_WORDS: [GroupId, ReadonlySet<string>][] = [
  ['nature', new Set(['wallflora'])],
  ['fences', new Set(['fence', 'railing', 'gate', 'picket'])],
  ['doors', new Set(['door', 'doorway'])],
  ['roofs', new Set(['roof'])],
  ['walls', new Set(['wall', 'wallpaper', 'walldetail', 'window', 'pillar', 'column', 'arch'])],
  [
    'ground',
    new Set([
      'ground',
      'floor',
      'grass',
      'water',
      'swamp',
      'cliff',
      'carpet',
      'path',
      'road',
      'soil',
      'topsoil',
      'sand',
    ]),
  ],
  [
    'nature',
    new Set([
      'tree',
      'flora',
      'stone',
      'rock',
      'bush',
      'hedge',
      'plant',
      'flower',
      'reed',
      'vine',
      'log',
      'stump',
      'mushroom',
      'crop',
      'oak',
      'pine',
      'birch',
      'palm',
      'fern',
    ]),
  ],
];

/** Piece canvases bigger than this are sheets (animation strips, atlases), not one placeable piece. */
const MAX_SOURCE_PX = 512;

export type LibrarySource = {
  /** The game's style set (`gm.lock.json` `set`): every card of it is offered. */
  set?: string;
  /** Packs the game already uses (`assets.lock.json`): their cards are offered too. */
  packs: readonly string[];
  allowAiGenerated: boolean;
};

/**
 * A game's map-maker library from the card catalog, plus where each item's thumbnail lives (a path under the asset
 * root). Only placeable pieces with a picture are offered: sprites and models the game may use in-game.
 */
export function editorLibrary(
  index: Pick<CardIndex, 'cards' | 'collections'>,
  source: LibrarySource,
): { library: EditorLibrary; thumbs: Map<string, string> } {
  const packs = new Set(source.packs);
  const items: EditorLibraryItem[] = [];
  const thumbs = new Map<string, string>();
  const packLabels = new Map<string, string>();
  for (const card of index.cards) {
    const pack = packOf(card.id);
    if (!pack || card.card_type !== 'asset') continue;
    if (!(source.set !== undefined && card.resolved.set === source.set) && !packs.has(pack)) continue;
    if (card.kind !== 'sprite' && card.kind !== 'model') continue;
    if (!statusAllowed(card.kind, card.status) || !card.resolved.rights.uses.includes('in-game')) continue;
    if (!source.allowAiGenerated && card.generation?.method === 'ai') continue;
    const thumb = thumbOf(card, pack);
    if (!thumb) continue;
    thumbs.set(card.id, thumb);
    const size = sizeOf(card);
    items.push({
      id: card.id,
      label: card.title.trim().slice(0, 120) || card.id,
      pack,
      group: groupOf(card),
      tag: tagOf(card.title),
      ...(size ? { size } : {}),
    });
    if (!packLabels.has(pack)) {
      const collection = card.collection ? index.collections[card.collection] : undefined;
      packLabels.set(pack, packLabel(collection?.title ?? pack));
    }
  }
  const order = new Map<string, number>(GROUPS.map((group, position) => [group.id, position]));
  items.sort((a, b) => order.get(a.group)! - order.get(b.group)! || a.label.localeCompare(b.label, 'en'));
  const used = new Set(items.map((item) => item.group));
  return {
    library: {
      ...(source.set ? { set: source.set } : {}),
      groups: GROUPS.filter((group) => used.has(group.id)).map((group) => ({ ...group })),
      packs: [...packLabels].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
      items,
    },
    thumbs,
  };
}

function words(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** `ZombieMale3` and `WallDetail13` are one word on disk; both spellings match. */
function wordSet(text: string): Set<string> {
  const set = new Set([
    ...words(text),
    ...text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean),
  ]);
  for (const word of [...set]) if (word.length > 3 && word.endsWith('s')) set.add(word.slice(0, -1));
  return set;
}

function groupOf(card: ResolvedCard): GroupId {
  if (card.subkind === 'character' || card.subkind === 'creature') return 'characters';
  if (card.subkind === 'fx') return 'effects';
  /* The title speaks first; the pack's folder names (`single-files/fences/...`) only when the title says nothing. */
  for (const found of [wordSet(card.title), wordSet(card.id.replace(/^t\d:[^/]+\//, '').replace(/@.*$/, ''))]) {
    for (const [group, matches] of GROUP_WORDS) if ([...matches].some((word) => found.has(word))) return group;
    if (found.has('shadow') || found.has('effect')) return 'effects';
  }
  return 'props';
}

/** The word a piece shares with its siblings: `Wall F17` → `Wall`, `ZombieMale3` → `Zombie`, `Pine Blue 2` → `Pine`. */
export function tagOf(title: string): string {
  const first = title.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/)[0] ?? '';
  if (!/^[A-Za-z]{2,}$/.test(first)) return 'Other';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** `2D HD Zombie Rural Tileset (Smallscaleint)` → `Zombie Rural`. */
export function packLabel(title: string): string {
  const label = title
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:smallscaleint|2d|hd|v\d+(?:\.\d+)*|tileset|assetpack|isometric|top ?down|complete)\b/gi, ' ')
    .replace(/\s-\s/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return label || title.trim();
}

function thumbOf(card: ResolvedCard, pack: string): string | undefined {
  const preview = card.previews?.thumb;
  if (preview && !preview.includes('..')) return preview;
  const primary = card.source?.files.find((file) => file.role === 'primary');
  const version = /@([^@/]+)$/.exec(card.id)?.[1];
  const image = card.image;
  if (!primary || !version || !image || !/^(?:png|webp)$/.test(primary.format ?? '')) return undefined;
  if (image.width_px > MAX_SOURCE_PX || image.height_px > MAX_SOURCE_PX || primary.path.includes('..'))
    return undefined;
  return `packs/${pack}/${version}/extracted/${primary.path}`;
}

function sizeOf(card: ResolvedCard): EditorLibraryItem['size'] {
  const bounds = card.geometry?.bounds_m;
  if (!bounds) return undefined;
  const span = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
  return span < 1 ? 'small' : span < 3 ? 'medium' : 'large';
}
