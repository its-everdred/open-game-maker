import type { GameManifest } from '@ogm/contracts';

import type { ResolvedCard } from './types.js';

type Palette = GameManifest['palette'];
type CategoryId = 'characters' | 'scenery' | 'props' | 'audio';

const categories: ReadonlyArray<{ id: CategoryId; label: string; kind: 'items' }> = [
  { id: 'characters', label: 'Characters', kind: 'items' },
  { id: 'scenery', label: 'Scenery', kind: 'items' },
  { id: 'props', label: 'Props', kind: 'items' },
  { id: 'audio', label: 'Audio', kind: 'items' },
];

/**
 * Build a request-only palette from the game's lock. The caller owns authorization and supplies
 * usable thumbnail URLs; raw asset-library paths and preview keys must not be sent to the browser.
 */
export function fallbackEditorPalette(
  lockedIds: readonly string[],
  cards: readonly ResolvedCard[],
  thumbnailUrl: (card: ResolvedCard) => string | undefined,
): { mode: 'request'; palette: Palette } {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const groups = new Map<CategoryId, Palette['items']>();
  for (const id of new Set(lockedIds)) {
    const card = byId.get(id);
    const category = categoryFor(card);
    const thumbnail = card ? thumbnailUrl(card) : undefined;
    const items = groups.get(category) ?? [];
    items.push({
      prefab: id,
      label: (card?.title.trim() || labelFromId(id)).slice(0, 200),
      category,
      ...(thumbnail === undefined ? {} : { thumbnail }),
      ...(card?.generation?.method === 'ai' ? { aiGenerated: true } : {}),
    });
    groups.set(category, items);
  }
  return {
    mode: 'request',
    palette: {
      categories: categories.filter(({ id }) => groups.has(id)).map((category) => ({ ...category })),
      items: categories.flatMap(({ id }) => groups.get(id) ?? []),
    },
  };
}

function categoryFor(card: ResolvedCard | undefined): CategoryId {
  if (card?.kind === 'audio') return 'audio';
  if (card?.subkind === 'character' || card?.subkind === 'creature') return 'characters';
  if (
    card?.subkind === 'nature' ||
    card?.subkind === 'building' ||
    card?.subkind === 'kit' ||
    card?.subkind === 'tile' ||
    card?.subkind === 'background' ||
    card?.kind === 'texture'
  )
    return 'scenery';
  return 'props';
}

function labelFromId(id: string): string {
  const name = (id.split('/').at(-1) ?? id)
    .split('@')[0]!
    .replace(/[-_.]+/g, ' ')
    .trim();
  return name ? name[0]!.toUpperCase() + name.slice(1) : id;
}
