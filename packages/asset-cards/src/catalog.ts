import { catalogKind, type CatalogKind } from './catalog-kind.js';
import { catalogMedia, type CatalogMedia } from './catalog-media.js';
import type { RecoveredMedia } from './catalog-recover.js';
import { packOf } from './families.js';
import type { CardIndex, ResolvedCard, Rights } from './types.js';

export type CatalogPackInput = { id: string; vendor?: string; title?: string; license?: string; store_url?: string };
export type CatalogPack = {
  id: string;
  vendor: string;
  title: string;
  storeUrl: string | null;
  counts: Partial<Record<CatalogKind, number>>;
};
export type CatalogAsset = {
  id: string;
  title: string;
  kind: CatalogKind;
  pack: Omit<CatalogPack, 'counts'>;
  license: string;
  rights: Rights & { attribution: string | null };
  aiGenerated: boolean;
  style: string | null;
  tags: string[];
  previews: CatalogMedia;
  usedIn: string[];
  clips: { name: string; duration_s: number; loop?: boolean }[];
};
export type CatalogIndex = { assets: CatalogAsset[]; packs: CatalogPack[]; recovered: Map<string, RecoveredMedia> };

/** Project the authoritative card index and pack catalogue without copying source assets. */
export function buildCatalog(index: CardIndex, inputs: readonly CatalogPackInput[]): CatalogIndex {
  const packs = new Map<string, CatalogPack>();
  for (const input of inputs)
    packs.set(input.id, {
      id: input.id,
      vendor: input.vendor ?? '',
      title: input.title ?? input.id,
      storeUrl: input.store_url ?? null,
      counts: {},
    });
  const assets: CatalogAsset[] = [];
  for (const card of index.cards) {
    const packId = packOf(card.id);
    const pack = packId && packs.get(packId);
    if (!pack) continue;
    if (card.card_type === 'collection') {
      const counts = card.collection_info?.counts ?? {};
      for (const [key, count] of Object.entries(counts)) {
        if (count === undefined) continue;
        const kind = catalogKind(key);
        // A broad count often repeats its detailed counts (e.g. audio and audio/music/track).
        // Attribute only the remainder to the broad key, then add each specific key once.
        const children = Object.entries(counts).filter(
          ([other]) => other.startsWith(`${key}/`) && !other.slice(key.length + 1).includes('/'),
        );
        const remainder = Math.max(0, count - children.reduce((sum, [, childCount]) => sum + (childCount ?? 0), 0));
        if (kind) pack.counts[kind] = (pack.counts[kind] ?? 0) + remainder;
      }
      continue;
    }
    const kind = catalogKind(card.kind ?? '', card.subkind);
    const collection = card.collection ? index.collections[card.collection] : undefined;
    if (
      !kind ||
      card.status === 'quarantined' ||
      card.status === 'rejected' ||
      collection?.status === 'quarantined' ||
      collection?.status === 'rejected'
    )
      continue;
    const packInfo = { id: pack.id, vendor: pack.vendor, title: pack.title, storeUrl: pack.storeUrl };
    assets.push(toCatalogAsset(card, kind, packInfo, collection));
  }
  return { packs: [...packs.values()].sort((a, b) => a.id.localeCompare(b.id)), assets, recovered: new Map() };
}

function toCatalogAsset(
  card: ResolvedCard,
  kind: CatalogKind,
  pack: CatalogAsset['pack'],
  collection: ResolvedCard | undefined,
): CatalogAsset {
  return {
    id: card.id,
    title: card.title,
    kind,
    pack,
    license: card.resolved.license,
    rights: { ...card.resolved.rights, attribution: (card.rights ?? collection?.rights)?.attribution ?? null },
    aiGenerated: card.generation?.method === 'ai',
    style: card.resolved.style_family ?? null,
    tags: [
      ...new Set([
        ...(card.describe?.objects ?? []),
        ...(card.describe?.keywords ?? []),
        ...(card.describe?.moods ?? []),
      ]),
    ],
    previews: catalogMedia(card),
    usedIn: [],
    clips: [...(card.anim?.clips ?? card.rig?.clips ?? [])].map(({ name, duration_s, loop }) => ({
      name,
      duration_s,
      ...(loop === undefined ? {} : { loop }),
    })),
  };
}

export type CatalogQuery = {
  words?: string;
  kind?: CatalogKind;
  pack?: string;
  style?: string;
  license?: string;
  use?: string;
  aiGenerated?: boolean;
};

/** Identical deterministic ordering for every caller of the catalogue. */
export function searchCatalog(index: CatalogIndex, query: CatalogQuery): CatalogAsset[] {
  const words = (query.words ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return index.assets
    .filter((asset) => {
      if (query.kind && asset.kind !== query.kind) return false;
      if (query.pack && asset.pack.id !== query.pack) return false;
      if (query.style && asset.style !== query.style) return false;
      if (query.license && asset.license !== query.license) return false;
      if (query.use && !asset.rights.uses.some((use) => use === query.use)) return false;
      if (query.aiGenerated !== undefined && asset.aiGenerated !== query.aiGenerated) return false;
      const text = [
        asset.id,
        asset.title,
        asset.kind,
        asset.pack.id,
        asset.pack.title,
        asset.pack.vendor,
        asset.style,
        ...asset.tags,
      ]
        .join(' ')
        .toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
