import { sceneDecorLayer, type SceneTile } from './tiled.js';

type TileLayer = { type: 'tilelayer'; name: string; width: number; height: number; data: number[] };
type ObjectLayer = { type: 'objectgroup'; name: string; objects: unknown[] };
type Tileset = { firstgid: number; name: string; tiles: { id: number }[] };
export type SceneTiledMap = {
  width: number;
  height: number;
  layers: (TileLayer | ObjectLayer)[];
  tilesets: Tileset[];
};

/** Merge into the game's existing decor; its caller still owns terrain and collision updates. */
export function mergeSceneDecor<T extends SceneTiledMap>(
  map: T,
  placements: readonly SceneTile[],
  lockedAssets: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
) {
  if (
    !Number.isSafeInteger(map.width) ||
    map.width < 1 ||
    !Number.isSafeInteger(map.height) ||
    map.height < 1 ||
    map.width * map.height > 1_000_000
  )
    throw new Error('invalid game map bounds');
  const decors = map.layers.filter((layer): layer is TileLayer => layer.type === 'tilelayer' && layer.name === 'decor');
  if (decors.length !== 1) throw new Error('game map must have exactly one decor layer');
  const decor = decors[0]!;
  if (decor.width !== map.width || decor.height !== map.height || decor.data.length !== map.width * map.height)
    throw new Error('game decor layer has invalid dimensions');
  const gids = new Set<number>();
  let largestGid = 0;
  for (const tileset of map.tilesets) {
    if (!Number.isSafeInteger(tileset.firstgid) || tileset.firstgid < 1) throw new Error('invalid game tileset');
    for (const tile of tileset.tiles) {
      const gid = tileset.firstgid + tile.id;
      if (
        !Number.isSafeInteger(tile.id) ||
        tile.id < 0 ||
        !Number.isSafeInteger(gid) ||
        gid > 0x1fffffff ||
        gids.has(gid)
      )
        throw new Error('invalid game tileset');
      gids.add(gid);
      largestGid = Math.max(largestGid, gid);
    }
  }
  const forbidden = new Set(reserved);
  decor.data.forEach((gid, index) => {
    if (!Number.isSafeInteger(gid) || gid < 0 || gid > 0x1fffffff || (gid !== 0 && !gids.has(gid)))
      throw new Error('invalid game decor tile');
    if (gid !== 0) forbidden.add(`${index % map.width},${Math.floor(index / map.width)}`);
  });
  const firstgid = largestGid + 1;
  const added = sceneDecorLayer(map.width, map.height, firstgid, placements, lockedAssets, forbidden);
  const layer = { ...decor, data: decor.data.map((gid, index) => added.layer.data[index] || gid) };
  return {
    map: {
      ...map,
      layers: map.layers.map((item) => (item === decor ? layer : item)),
      tilesets: [...map.tilesets, added.tileset],
    },
    occupied: added.occupied,
    collision: added.collision,
  };
}
