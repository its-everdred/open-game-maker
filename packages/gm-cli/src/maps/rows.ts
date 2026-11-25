import { MAP_FEATURES, type LayoutRow } from '@ogm/asset-cards';

import { parseQuery, type SpecFlags } from './specs.js';

export const SCALES = ['battlemap', 'building', 'settlement', 'region', 'world'];
export const GRIDS = ['square', 'hex', 'none'];
export const FLOWS = ['linear', 'branching', 'hub-and-spoke', 'loop', 'maze', 'open'];
export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge'];

const FEATURES = new Set<string>(MAP_FEATURES);

/** A query over {@link LayoutRow} columns. Hard filters exclude; words and a size word only rank. */
export type RowQuery = {
  rooms?: [number, number];
  loops?: { min: number; exact: boolean };
  secrets?: number;
  levels?: number;
  size?: string;
  sizeWord?: string;
  /** A map type or environment word: matches the row's type, biome or one of its themes. */
  places: string[];
  scales: string[];
  grids: string[];
  flows: string[];
  features: string[];
  words: string[];
  /** `tileset` rows only, or map rows only; both by default. */
  resource?: 'map' | 'tileset';
};

export type RowFlags = SpecFlags & {
  levels?: number;
  biome?: string | string[];
  scale?: string | string[];
  grid?: string | string[];
  flow?: string | string[];
  feature?: string | string[];
  tilesets?: boolean;
  maps?: boolean;
};

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((one) => one.split(','))
    .map((one) => one.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Reads columns from the words and flags. In map-only searches, bare place and feature words rank results; explicit
 * type, biome and feature flags remain filters. Other searches retain the structured word parser's filters.
 */
export function parseRowQuery(tokens: string[], flags: RowFlags = {}): RowQuery {
  const base = parseQuery(tokens, flags.maps ? { ...flags, type: undefined } : flags);
  const features = list(flags.feature);
  const words: string[] = [];
  for (const word of base.words) {
    if (!flags.maps && FEATURES.has(word)) features.push(word);
    else words.push(word);
  }
  if (flags.maps) words.push(...base.types);
  return {
    ...(base.rooms ? { rooms: base.rooms } : {}),
    ...(base.loops ? { loops: base.loops } : {}),
    ...(base.secrets === undefined ? {} : { secrets: base.secrets }),
    ...(base.size === undefined ? {} : { size: base.size }),
    ...(base.sizeWord === undefined ? {} : { sizeWord: base.sizeWord }),
    ...(flags.levels === undefined ? {} : { levels: flags.levels }),
    ...(flags.tilesets === true ? { resource: 'tileset' as const } : {}),
    ...(flags.maps === true ? { resource: 'map' as const } : {}),
    places: [...new Set([...(flags.maps ? list(flags.type) : base.types), ...list(flags.biome)])],
    scales: list(flags.scale),
    grids: list(flags.grid),
    flows: list(flags.flow),
    features: [...new Set(features)],
    words,
  };
}

/** `undefined` never satisfies a hard filter: an unknown room count is not "3-5 rooms". */
export function matchRow(row: LayoutRow, q: RowQuery): { hard: boolean; score: number } {
  if (q.resource !== undefined && row.resource !== q.resource) return { hard: false, score: 0 };
  const inRange = (value: number | null, low: number, high: number) => value !== null && value >= low && value <= high;
  if (q.rooms && !inRange(row.rooms, q.rooms[0], q.rooms[1])) return { hard: false, score: 0 };
  if (q.loops) {
    const ok = q.loops.exact ? row.loops === q.loops.min : row.loops !== null && row.loops >= q.loops.min;
    if (!ok) return { hard: false, score: 0 };
  }
  if (q.secrets !== undefined && (row.secrets === null || row.secrets < q.secrets)) return { hard: false, score: 0 };
  if (q.levels !== undefined && (row.levels === null || row.levels < q.levels)) return { hard: false, score: 0 };
  if (q.size && row.size !== q.size) return { hard: false, score: 0 };
  const places = [row.type, row.biome, ...row.themes].filter((place): place is string => place !== null);
  if (q.places.length > 0 && !q.places.some((place) => places.includes(place))) return { hard: false, score: 0 };
  if (q.scales.length > 0 && (row.scale === null || !q.scales.includes(row.scale))) return { hard: false, score: 0 };
  if (q.grids.length > 0 && (row.grid === null || !q.grids.includes(row.grid))) return { hard: false, score: 0 };
  if (q.flows.length > 0 && (row.flow === null || !q.flows.includes(row.flow))) return { hard: false, score: 0 };
  if (q.features.length > 0 && !q.features.every((feature) => (row.features as string[]).includes(feature)))
    return { hard: false, score: 0 };

  const text = [
    ...places,
    row.size,
    row.flow,
    row.grid,
    ...row.features,
    row.title,
    row.source_file,
    row.source_folder,
  ].filter((value): value is string => typeof value === 'string');
  let score = [q.rooms, q.loops, q.secrets, q.levels, q.size].filter((term) => term !== undefined).length;
  score += q.places.length + q.scales.length + q.grids.length + q.flows.length + q.features.length;
  if (q.sizeWord !== undefined && row.size === q.sizeWord) score += 1;
  const normalize = (value: string) => value.toLowerCase().replace(/s$/, '');
  const tokens = (value: string) => [value.toLowerCase(), ...value.toLowerCase().split(/[^a-z0-9]+/)].map(normalize);
  const terms = text.flatMap(tokens);
  const sourceTerms = [row.title, row.source_file].flatMap((value) => (typeof value === 'string' ? tokens(value) : []));
  for (const word of q.words) {
    if (terms.includes(normalize(word))) score += 1;
    if (sourceTerms.includes(normalize(word))) score += 2;
  }
  return { hard: true, score };
}

const dash = (value: string | number | null) => (value === null ? '-' : String(value));

/** One row of layout facts, followed by vision-authorized thumbnail and source information when available. */
export function layoutLine(row: LayoutRow): string {
  const grid = row.grid === null ? '-' : `${row.grid}${row.cell_px === null ? '' : `@${row.cell_px}`}`;
  const graph = [row.rooms, row.loops, row.secrets].map(dash).join('/');
  return [
    row.id,
    dash(row.type),
    dash(row.biome),
    dash(row.scale),
    grid,
    graph,
    dash(row.size),
    dash(row.flow),
    row.features.length > 0 ? row.features.join(',') : '-',
    ...(row.resource === 'map' && (row.thumbnail || row.source_folder || row.source_file)
      ? [row.thumbnail ?? '-', row.source_folder ?? '-', row.source_file ?? '-']
      : []),
  ]
    .map((value) =>
      Array.from(value, (character) => {
        const code = character.codePointAt(0)!;
        return code < 32 || (code >= 127 && code <= 159) ? `\\u${code.toString(16).padStart(4, '0')}` : character;
      }).join(''),
    )
    .join('  ');
}

/** `20 of 41 (map 39, tileset 2) — biome: dungeon 12, crypt 5`, so an agent narrows instead of paging. */
export function facetLine(shown: number, total: number, rows: LayoutRow[]): string {
  const top = (pick: (row: LayoutRow) => string | null) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = pick(row);
      if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 5)
      .map(([value, n]) => `${value} ${n}`)
      .join(', ');
  };
  const maps = rows.filter((row) => row.resource === 'map').length;
  const tilesets = rows.filter((row) => row.resource === 'tileset').length;
  const head = `${shown} of ${total} (map ${maps}, tileset ${tilesets})`;
  const biome = top((row) => row.biome);
  return biome ? `${head} — biome: ${biome}` : head;
}
