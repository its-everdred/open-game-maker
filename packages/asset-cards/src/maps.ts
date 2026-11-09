import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { layoutMetrics, validateLayoutSpec, type MapLayoutSpec } from '@ogm/contracts';

import { statusAllowed } from './search.js';
import type { CardIndex, ResolvedCard } from './types.js';

/** The map-inspiration index: layout columns, kept beside `cards.index.json`. */
export const MAP_INDEX_PATH = join('index', 'maps.index.json');
export const MAP_LAYOUTS_DIR = join('index', 'map-layouts');

/** C3 §12 / the map-layout-spec feature vocabulary, plus the drawn structures a builder asks for by name. */
export const MAP_FEATURES = [
  'pillar',
  'water',
  'pit',
  'chasm',
  'lava',
  'altar',
  'statue',
  'throne',
  'tomb',
  'sarcophagus',
  'trap',
  'treasure',
  'chest',
  'fireplace',
  'well',
  'fountain',
  'bed',
  'table',
  'bookshelf',
  'barrel',
  'crate',
  'rubble',
  'stalagmite',
  'cage',
  'portal',
  'lever',
  'light-source',
  'spawn-hint',
  'exit-hint',
  'road',
  'bridge',
  'stairs',
  'door',
] as const;

export type MapFeature = (typeof MAP_FEATURES)[number];

const FEATURES = new Set<string>(MAP_FEATURES);

/**
 * One queryable row per map or tileset resource. Columns only: no file path, no preview key and no description, so a
 * result page costs an agent a line per hit and can never send it to look at the image (research 2026-11-05 §4).
 */
export type LayoutRow = {
  id: string;
  /** `map` for an inspiration map, `tileset` for a tile card a map can be drawn with. */
  resource: 'map' | 'tileset';
  /** Map type for a map; the compatibility set (else the style family) for a tileset. */
  type: string | null;
  /** Judged themes plus the card's environments: what a type or biome filter may match. */
  themes: string[];
  biome: string | null;
  scale: string | null;
  grid: 'square' | 'hex' | 'none' | null;
  cols: number | null;
  rows: number | null;
  cell_px: number | null;
  rooms: number | null;
  connections: number | null;
  entrances: number | null;
  dead_ends: number | null;
  loops: number | null;
  secrets: number | null;
  levels: number | null;
  size: string | null;
  flow: string | null;
  features: string[];
  /** `spec` when the graph counts come from a validated layout spec, `card` when only code measurements exist. */
  from: 'spec' | 'card';
  /** The selected validated spec, used to write a graph lookup without exposing its source path. */
  layout_id: string | null;
};

export type MapIndex = { version: 1; built: string; vocab: string; rows: LayoutRow[] };

/** A spec that passed `validateLayoutSpec` and whose graph agrees with its `tags.computed`. */
export type LayoutSpecRow = Pick<MapLayoutSpec, 'id' | 'source' | 'grid' | 'tags' | 'features'>;

const TILE = (card: ResolvedCard) => card.kind === 'sprite' && card.subkind === 'tile';

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Every feature word a card already carries, filtered to the closed vocabulary. */
export function featuresOf(card: ResolvedCard): MapFeature[] {
  const describe = card.describe ?? {};
  const words = [...(card.map?.layout?.features ?? []), ...(describe.objects ?? []), ...(describe.keywords ?? [])];
  const found = words.map((word) => word.toLowerCase().trim()).filter((word) => FEATURES.has(word));
  if ((card.resolved.environments ?? []).includes('road')) found.push('road');
  return unique(found.sort()) as MapFeature[];
}

/** The grid: the card's own block, else the spec's, else the export's detected cell size (a square grid). */
function gridOf(card: ResolvedCard, spec: LayoutSpecRow | undefined): Partial<LayoutRow> {
  const block = card.map?.layout?.grid;
  const detected = card.map?.grid_detected;
  const grid = spec?.grid;
  return {
    grid: block?.type ?? grid?.type ?? (detected?.cell_px ? 'square' : null),
    cols: block?.cols ?? grid?.cols ?? detected?.cols ?? null,
    rows: block?.rows ?? grid?.rows ?? detected?.rows ?? null,
    cell_px: block?.cell_px ?? grid?.cell_px ?? detected?.cell_px ?? null,
  };
}

/** C3 §12 counts: the card's own layout block first, then a validated spec, so a re-tagged card wins over the join. */
function countsOf(card: ResolvedCard, spec: LayoutSpecRow | undefined): Partial<LayoutRow> {
  const block = card.map?.layout;
  const computed = spec?.tags.computed;
  return {
    rooms: block?.rooms ?? computed?.room_count ?? null,
    connections: block?.connections ?? computed?.connection_count ?? null,
    entrances: block?.entrances ?? computed?.entrance_count ?? null,
    dead_ends: block?.dead_ends ?? computed?.dead_end_count ?? null,
    loops: block?.loops ?? computed?.loop_count ?? null,
    secrets: block?.secrets ?? computed?.secret_count ?? null,
    levels: block?.levels ?? card.map?.levels_shown ?? null,
    size: block?.size_class ?? computed?.size_class ?? null,
    flow: block?.flow ?? spec?.tags.judged.flow ?? null,
  };
}

/** Every place word a filter may use: the spec's judged themes, then the card's judged environments. */
function themesOf(card: ResolvedCard, spec: LayoutSpecRow | undefined): string[] {
  const judged = spec?.tags.judged.themes ?? [];
  return [...new Set([...judged, ...(card.resolved.environments ?? [])])];
}

/** Map types that are not themselves an environment word, so a card without judged environments still gets a place. */
const BIOME_OF_TYPE: Record<string, string> = {
  keep: 'castle',
  building: 'interior',
  ship: 'ocean',
  wilderness: 'forest',
};

/** The biome is a place, never a paragraph: the card's layout block, then its judged environments, then its map type. */
function biomeOf(card: ResolvedCard): string | null {
  const block = card.map?.layout;
  if (block?.biome) return block.biome;
  const environment = (card.resolved.environments ?? [])[0];
  if (environment) return environment;
  const type = card.map?.map_type;
  if (type === undefined) return null;
  return BIOME_OF_TYPE[type] ?? (type === 'battlemap' || type === 'region' ? null : type);
}

/**
 * One row per map or tileset resource, or `null` when the resource is not one an agent may build from: inspiration
 * maps need `derive-layout` (C3 §10) and tilesets need `in-game`, and standees, symbol sheets and unusable images are
 * not maps at all.
 */
export function layoutRow(card: ResolvedCard, spec?: LayoutSpecRow): LayoutRow | null {
  if (TILE(card)) {
    const sheet = card.sprite?.sheet;
    return {
      id: card.id,
      resource: 'tileset',
      type: card.resolved.set ?? card.resolved.style_family ?? null,
      themes: themesOf(card, undefined),
      biome: biomeOf(card),
      scale: 'battlemap',
      grid: card.sprite?.tile_px ? 'square' : null,
      cols: sheet?.cols ?? null,
      rows: sheet?.rows ?? null,
      cell_px: card.sprite?.tile_px ?? null,
      rooms: null,
      connections: null,
      entrances: null,
      dead_ends: null,
      loops: null,
      secrets: null,
      levels: null,
      size: null,
      flow: null,
      features: featuresOf(card),
      from: 'card',
      layout_id: null,
    };
  }
  if (card.kind !== 'inspiration' || card.subkind !== 'map') return null;
  if (card.map?.is_map === false || card.map?.usable === 'no') return null;
  const row: LayoutRow = {
    id: card.id,
    resource: 'map',
    type: card.map?.map_type ?? null,
    themes: themesOf(card, spec),
    biome: biomeOf(card),
    scale: card.map?.scale ?? null,
    grid: null,
    cols: null,
    rows: null,
    cell_px: null,
    rooms: null,
    connections: null,
    entrances: null,
    dead_ends: null,
    loops: null,
    secrets: null,
    levels: null,
    size: null,
    flow: null,
    features: featuresOf(card),
    from: spec ? 'spec' : 'card',
    layout_id: spec?.id ?? null,
  };
  return { ...row, ...gridOf(card, spec), ...countsOf(card, spec) };
}

/**
 * The layout index. Rows are gated on the source card's resolved rights here, so a spec whose source lacks
 * `derive-layout` never reaches the file an agent queries; the count of what the gate held back is returned instead.
 */
export function buildMapIndex(index: CardIndex, specs: LayoutSpecRow[] = []): { maps: MapIndex; hidden: number } {
  const byCard = new Map<string, LayoutSpecRow[]>();
  for (const spec of specs) byCard.set(spec.source.card_id, [...(byCard.get(spec.source.card_id) ?? []), spec]);
  const rows: LayoutRow[] = [];
  let hidden = 0;
  for (const card of index.cards) {
    if (!statusAllowed(card.kind, card.status)) continue;
    // One spec per card: the one the card points at wins, so a newer extraction on the same image never displaces it.
    const candidates = byCard.get(card.id) ?? [];
    const spec = candidates.find((one) => one.id === card.map?.layout_spec.id) ?? candidates[0];
    const row = layoutRow(card, spec);
    if (!row) continue;
    const uses = card.resolved.rights.uses;
    const allowed = row.resource === 'map' ? uses.includes('derive-layout') : uses.includes('in-game');
    if (!allowed) {
      hidden += 1;
      continue;
    }
    rows.push(row);
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { maps: { version: 1, built: new Date().toISOString(), vocab: index.vocab, rows }, hidden };
}

export async function writeMapIndex(root: string, maps: MapIndex): Promise<string> {
  const path = join(root, MAP_INDEX_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(maps)}\n`);
  return path;
}

function mapLayoutPath(root: string, cardId: string): string {
  const key = createHash('sha256').update(cardId).digest('hex');
  return join(root, MAP_LAYOUTS_DIR, `${key}.json`);
}

/** Write one rights-gated derived graph per indexed map, keyed without exposing a source-library path. */
export async function writeMapLayouts(root: string, maps: MapIndex, specs: MapLayoutSpec[]): Promise<number> {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const selected = maps.rows.flatMap((row) => {
    if (row.resource !== 'map' || row.layout_id === null) return [];
    const spec = byId.get(row.layout_id);
    return spec ? [{ cardId: row.id, spec }] : [];
  });
  await mkdir(join(root, MAP_LAYOUTS_DIR), { recursive: true });
  await Promise.all(
    selected.map(({ cardId, spec }) => writeFile(mapLayoutPath(root, cardId), `${JSON.stringify(spec)}\n`)),
  );
  return selected.length;
}

/** Read one derived graph. Recheck its index binding and graph invariants so stale or modified caches fail closed. */
export async function loadMapLayout(
  root: string,
  cardId: string,
  expectedLayoutId: string,
): Promise<MapLayoutSpec | null> {
  try {
    const result = validateLayoutSpec(JSON.parse(await readFile(mapLayoutPath(root, cardId), 'utf8')));
    if (!result.ok) return null;
    const spec = result.spec;
    if (spec.source.card_id !== cardId || spec.id !== expectedLayoutId || spec.extraction.status === 'image-only') {
      return null;
    }
    const metrics = layoutMetrics(spec);
    const computed = spec.tags.computed;
    const countsAgree = (['room_count', 'connection_count', 'loop_count', 'dead_end_count', 'secret_count'] as const).every(
      (key) => metrics[key] === computed[key],
    );
    return countsAgree && metrics.endpoints_ok && metrics.areas_ok && metrics.total_area_cells === computed.total_area_cells
      ? spec
      : null;
  } catch {
    return null;
  }
}

/** The map index, or an empty one: a missing file means "run `gm maps index`", never a scan. */
export async function loadMapIndex(root: string): Promise<MapIndex> {
  try {
    const parsed = JSON.parse(await readFile(join(root, MAP_INDEX_PATH), 'utf8')) as MapIndex;
    return parsed.version === 1 && Array.isArray(parsed.rows) ? parsed : { version: 1, built: '', vocab: '', rows: [] };
  } catch {
    return { version: 1, built: '', vocab: '', rows: [] };
  }
}
