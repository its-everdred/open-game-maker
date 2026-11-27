import { z } from 'zod';

import { assetFacts, roleFromName, shippedFacings, type LockEntry, type PackFacts } from './facts.js';
import type { Actor, Facing, Finding, Piece, Role, Scene } from './model.js';

const GID_MASK = 0x1fffffff;
const ROTATIONS: Record<number, Facing> = { 0: 'E', 90: 'N', 180: 'W', 270: 'S' };
const ROLES: ReadonlySet<string> = new Set<Role>([
  'ground',
  'path',
  'fence',
  'wall',
  'post',
  'door',
  'opening',
  'roof',
  'seat',
  'prop',
]);
const TAGS = ['ruin', 'formal', 'gate', 'exit'] as const;

const property = z.object({ name: z.string(), value: z.unknown() });
const tiledMap = z.object({
  orientation: z.literal('isometric'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().optional(),
  tileheight: z.number().optional(),
  layers: z.array(
    z.union([
      z.object({
        type: z.literal('tilelayer'),
        name: z.string(),
        width: z.number().int().positive(),
        data: z.array(z.number().int().nonnegative()),
      }),
      z.object({
        type: z.literal('objectgroup'),
        name: z.string(),
        objects: z.array(
          z.object({
            id: z.number(),
            name: z.string().optional(),
            x: z.number(),
            y: z.number(),
            properties: z.array(property).optional(),
          }),
        ),
      }),
    ]),
  ),
  tilesets: z.array(
    z.object({
      firstgid: z.number().int().positive(),
      tiles: z.array(z.object({ id: z.number().int().nonnegative(), properties: z.array(property).optional() })),
    }),
  ),
});

type Properties = z.infer<typeof property>[] | undefined;
const prop = (properties: Properties, name: string): unknown => properties?.find((p) => p.name === name)?.value;

export interface MapSource {
  json: unknown;
  /** Where this map's cell (0, 0) sits in scene cells; a surround drawn beneath the scene is offset. */
  offset?: { x: number; y: number };
  /** Prefix for piece keys, so two maps' pieces stay distinct. */
  prefix?: string;
  /** A surround drawn beneath the scene: it fills the frame but its pieces are not the scene's dressing. */
  under?: boolean;
}

function tagsOf(properties: Properties): Set<string> {
  const tags = new Set<string>();
  const listed = prop(properties, 'tags');
  if (typeof listed === 'string') for (const tag of listed.split(',')) if (tag.trim()) tags.add(tag.trim());
  for (const tag of TAGS) if (prop(properties, tag) === true) tags.add(tag);
  return tags;
}

/** Read Tiled-style isometric maps (the SmallScaleInt adapter's subset, any layer names) into one scene. */
export function readTiledScene(sources: readonly MapSource[], pack: PackFacts, lock: Record<string, LockEntry>): Scene {
  const pieces: Piece[] = [];
  const actors: Actor[] = [];
  const notes: Finding[] = [];
  const flipped = new Set<string>();
  const unsupportedScales = new Map<string, { asset: string; cells: { x: number; y: number }[] }>();
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const source of sources) {
    const map = tiledMap.parse(source.json);
    const dx = source.offset?.x ?? 0;
    const dy = source.offset?.y ?? 0;
    const prefix = source.prefix ?? '';
    const [tw, th] = pack.tile;
    if ((map.tilewidth ?? tw) !== tw || (map.tileheight ?? th) !== th) {
      notes.push({
        check: 'facts',
        id: 'facts/tile-size',
        severity: 'high',
        message: `map tiles are ${map.tilewidth}x${map.tileheight}; the ${pack.set} pack's tiles are ${tw}x${th}, so its pieces will not join`,
        cells: [],
        objects: [`${prefix}map`],
      });
    }
    bounds.minX = Math.min(bounds.minX, dx);
    bounds.minY = Math.min(bounds.minY, dy);
    bounds.maxX = Math.max(bounds.maxX, dx + map.width - 1);
    bounds.maxY = Math.max(bounds.maxY, dy + map.height - 1);
    const tiles = new Map<number, Properties>();
    for (const set of map.tilesets) for (const tile of set.tiles) tiles.set(set.firstgid + tile.id, tile.properties);
    for (const layer of map.layers) {
      if (layer.type === 'objectgroup') {
        // A surround's spawns belong to its own scene, never this one.
        if (source.under) continue;
        for (const object of layer.objects) {
          const prefab = prop(object.properties, 'prefab');
          actors.push({
            id: `${prefix}${layer.name}:${object.id}`,
            name: object.name ?? String(object.id),
            ...(typeof prefab === 'string' ? { prefab } : {}),
            x: Math.floor(object.x) + dx,
            y: Math.floor(object.y) + dy,
          });
        }
        continue;
      }
      layer.data.forEach((stored, index) => {
        if (stored === 0) return;
        const gid = stored & GID_MASK;
        if (gid !== stored) flipped.add(`${prefix}${layer.name}`);
        const properties = tiles.get(gid);
        const asset = prop(properties, 'asset');
        if (typeof asset !== 'string') throw new Error(`tile gid ${gid} has no asset`);
        const rotation = prop(properties, 'rotation') ?? 0;
        const facing = ROTATIONS[(((Number(rotation) % 360) + 360) % 360) as 0];
        if (!facing) throw new Error(`tile gid ${gid} rotation ${String(rotation)} is not 0, 90, 180 or 270`);
        const declared = prop(properties, 'role');
        const role =
          typeof declared === 'string' && ROLES.has(declared) ? (declared as Role) : roleFromName(asset, layer.name);
        const solid = prop(properties, 'solid');
        const elevation = prop(properties, 'elevation');
        const scale = prop(properties, 'scale');
        const x = (index % layer.width) + dx;
        const y = Math.floor(index / layer.width) + dy;
        const validScale = typeof scale === 'number' && Number.isFinite(scale) && scale > 0;
        if (scale !== undefined && (!validScale || (layer.name === 'floor' && scale !== 1))) {
          const key = `${prefix}${layer.name}:${gid}`;
          if (!unsupportedScales.has(key)) unsupportedScales.set(key, { asset, cells: [] });
          unsupportedScales.get(key)!.cells.push({ x, y });
        }
        const facts = assetFacts(pack, lock, asset);
        const facings = shippedFacings(lock, asset);
        pieces.push({
          key: `${prefix}${layer.name}:${x},${y}`,
          layer: layer.name,
          x,
          y,
          asset,
          facing,
          solid: typeof solid === 'boolean' ? solid : layer.name === 'wall',
          role,
          tags: tagsOf(properties),
          under: source.under === true,
          elevation: typeof elevation === 'number' && layer.name !== 'roof' ? elevation : 0,
          ...(validScale && (layer.name !== 'floor' || scale === 1) ? { scale } : {}),
          ...(facts?.edges?.[facing] ? { edge: facts.edges[facing], edges: facts.edges } : {}),
          ...(facts?.alpha?.[facing] ? { alpha: facts.alpha[facing] } : {}),
          ...(facts?.size ? { size: facts.size } : {}),
          ...(facings ? { facings } : {}),
        });
      });
    }
  }
  if (flipped.size) {
    notes.push({
      check: 'facts',
      id: 'facts/tile-flip',
      severity: 'high',
      message: `layers ${[...flipped].join(', ')} use Tiled flip flags, which the pack adapter refuses; use a facing instead`,
      cells: [],
      objects: [...flipped],
    });
  }
  for (const [key, { asset, cells }] of unsupportedScales) {
    notes.push({
      check: 'facts',
      id: 'facts/unsupported-scale',
      severity: 'high',
      message: `${cells.length} ${asset} piece(s) have an unsupported scale; the game ignores it`,
      cells,
      objects: [key],
    });
  }
  return {
    bounds,
    pieces,
    actors,
    notes,
    anchorY: pack.anchorY,
    tile: pack.tile,
  };
}
