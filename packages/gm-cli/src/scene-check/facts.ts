import type { Bounds, CellEdge, Facing, Role } from './model.js';

/** Measured facts about one asset, from its pack adapter. Absent fields are unmeasured, never guessed. */
export interface AssetFacts {
  edges?: Partial<Record<Facing, CellEdge>>;
  alpha?: Partial<Record<Facing, Bounds>>;
  size?: readonly [number, number];
}

/** What the checks need from a pack adapter. */
export interface PackFacts {
  set: string;
  tile: readonly [number, number];
  anchorY: number;
  asset(id: string): AssetFacts | undefined;
}

/** The game's asset list entry fields the checks read. */
export interface LockEntry {
  derived_from?: string[];
  meta?: { sprite?: { facings?: Record<string, string> } };
}

const FACINGS: readonly Facing[] = ['E', 'N', 'W', 'S'];
const EDGES: ReadonlySet<string> = new Set(['xMin', 'xMax', 'yMin', 'yMax']);

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const bounds = (value: unknown): Bounds | undefined =>
  Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number')
    ? (value as unknown as Bounds)
    : undefined;

/**
 * SmallScaleInt facts from `@gm/pack-smallscaleint`. Edges and alpha bounds come from its measured
 * `structuralCardFacts`; an adapter build without them yields no edges, so edge checks report missing facts.
 */
export function smallScaleIntFacts(adapter: Record<string, unknown>): PackFacts {
  const conventions = record(adapter.conventions);
  const tile = record(record(conventions?.tile)?.value);
  const footprint = tile?.footprint;
  const cardFacts = typeof adapter.structuralCardFacts === 'function' ? adapter.structuralCardFacts : undefined;
  const images = record(record(adapter.structuralImageBounds)?.value);
  return {
    set: 'smallscaleint',
    tile: Array.isArray(footprint) ? [Number(footprint[0]), Number(footprint[1])] : [128, 64],
    // IsoMap.render sets each piece's origin to image y 208, the ground face's measured centre.
    anchorY: 208,
    asset(id) {
      const card = record((cardFacts as ((id: string) => unknown) | undefined)?.(id));
      if (!card) return undefined;
      const facts: AssetFacts = {};
      const edges: Partial<Record<Facing, CellEdge>> = {};
      const alpha: Partial<Record<Facing, Bounds>> = {};
      for (const facing of FACINGS) {
        const entry = record(card[facing]);
        const edge = (record(entry?.edges)?.value as unknown[] | undefined)?.[0];
        if (typeof edge === 'string' && EDGES.has(edge)) edges[facing] = edge as CellEdge;
        const box = bounds(record(entry?.alpha_bounds)?.value);
        if (box) alpha[facing] = box;
      }
      if (Object.keys(edges).length) facts.edges = edges;
      if (Object.keys(alpha).length) facts.alpha = alpha;
      const size = record(images?.[id])?.size;
      if (Array.isArray(size) && size.length === 2) facts.size = [Number(size[0]), Number(size[1])];
      return facts;
    },
  };
}

/** Facts for an asset, falling back to the first source it was derived from (a cropped or recoloured copy). */
export function assetFacts(pack: PackFacts, lock: Record<string, LockEntry>, id: string): AssetFacts | undefined {
  return pack.asset(id) ?? lock[id]?.derived_from?.map((source) => pack.asset(source)).find(Boolean);
}

/** Facings the game's asset list says the asset ships, or undefined when the list does not say. */
export function shippedFacings(lock: Record<string, LockEntry>, id: string): Facing[] | undefined {
  const facings = lock[id]?.meta?.sprite?.facings;
  if (!facings) return undefined;
  return Object.keys(facings).filter((name): name is Facing => (FACINGS as readonly string[]).includes(name));
}

const WORDS: readonly [RegExp, Role][] = [
  [/fence|railing|palisade/, 'fence'],
  [/door/, 'door'],
  [/arch|gate/, 'opening'],
  [/roof/, 'roof'],
  [/pillar|post|column|pier/, 'post'],
  [/wall/, 'wall'],
  [/bench|chair|seat|stool/, 'seat'],
];

/**
 * Role from the asset's own name (last id segment), then its layer: packs name their pieces this way, and a
 * ground tile on a wall layer is still ground. Unnamed pieces on the floor layer are ground; elsewhere props.
 */
export function roleFromName(asset: string, layer: string): Role {
  const name = asset.replace(/@.*$/, '').split('/').pop()!.toLowerCase();
  if (/paving|path|road|cobble|stepping/.test(name)) return 'path';
  if (/ground|grass|dirt|soil|sand|floor/.test(name)) return 'ground';
  for (const [pattern, role] of WORDS) if (pattern.test(name)) return role;
  return layer === 'floor' ? 'ground' : 'prop';
}
