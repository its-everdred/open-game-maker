import {
  SceneDocSchema,
  type SceneDoc,
  type SceneLayer,
  type SceneObject,
  type SceneTile,
} from '@ogm/contracts/browser';

import { IsoMap, type TileFacing, type TiledIsoMap } from './map.js';

export const SMALLSCALEINT_SCENE_ADAPTER = 'smallscaleint';
/** The object layer that holds Tiled spawn points, and the `asset` its objects carry. */
export const SPAWNS_LAYER = 'spawns';
export const SPAWN_ASSET = 'spawn';

const TILE_HEIGHT = 64;
const ROTATION: Record<TileFacing, number> = { E: 0, N: 90, W: 180, S: 270 };

type SpawnJson = { id: number; name?: string; x: number; y: number; properties?: { name: string; value: unknown }[] };

/** Tiled names numbered sprite layers `wall#1`; scene ids cannot hold `#`. */
const sceneLayerId = (name: string): string => name.replace('#', '-');
const tiledLayerName = (id: string): string => id.replace(/^(wall|decor|roof)-([1-9]\d*)$/, '$1#$2');
const defaultSolid = (layer: string): boolean => layer === 'wall';

/**
 * Tiled-style SmallScaleInt map to a scene document. Every piece becomes a tile keyed by cell on its layer, with an
 * explicit facing, and `props.solid` only where it differs from the layer default (walls block, the rest do not).
 * Spawns become objects on the `spawns` layer; a pose is the Tiled object position in tile-height (64 px) units.
 */
export function isoMapToScene(json: TiledIsoMap, ids: { game: string; scene: string }): SceneDoc {
  const map = new IsoMap(json);
  const layers: Record<string, SceneLayer> = {};
  json.layers.forEach((layer, order) => {
    layers[sceneLayerId(layer.name)] =
      layer.type === 'objectgroup' ? { kind: 'objects', order } : { kind: 'tiles', order, tiles: {} };
  });
  for (const piece of map.pieces()) {
    const layerName = piece.key.slice(0, piece.key.indexOf(':'));
    const tile: SceneTile = {
      asset: piece.asset,
      facing: piece.facing,
      ...(piece.elevation === undefined ? {} : { elevation: piece.elevation }),
      ...(piece.solid === defaultSolid(piece.layer) ? {} : { props: { solid: piece.solid } }),
    };
    layers[sceneLayerId(layerName)]!.tiles![`${piece.x},${piece.y}`] = tile;
  }
  const objects: Record<string, SceneObject> = {};
  for (const spawn of map.spawns) {
    const props = {
      ...(spawn.name === undefined ? {} : { name: spawn.name }),
      ...(spawn.prefab === undefined ? {} : { prefab: spawn.prefab }),
    };
    objects[`spawn-${spawn.id}`] = {
      asset: SPAWN_ASSET,
      layer: SPAWNS_LAYER,
      pose: { x: spawn.x / TILE_HEIGHT, y: spawn.y / TILE_HEIGHT },
      ...(Object.keys(props).length > 0 ? { props } : {}),
    };
  }
  return SceneDocSchema.parse({
    schemaVersion: 1,
    game: ids.game,
    scene: ids.scene,
    packAdapter: SMALLSCALEINT_SCENE_ADAPTER,
    bounds: { width: map.width, height: map.height },
    layers,
    objects,
    hd2d: {},
  });
}

function refuse(message: string): never {
  throw new Error(`scene cannot become a SmallScaleInt map: ${message}`);
}

function spawnOf(id: string, object: SceneObject): SpawnJson {
  const tiledId = /^spawn-(-?\d+)$/.exec(id)?.[1];
  if (tiledId === undefined) refuse(`spawn object "${id}" must be named spawn-<number>`);
  if (object.asset !== SPAWN_ASSET) refuse(`object "${id}" on the spawns layer must have asset "${SPAWN_ASSET}"`);
  const extra = (['rotation', 'facing', 'flip'] as const).filter((field) => object[field] !== undefined);
  if (object.pose.elevation !== undefined) refuse(`spawn "${id}" has an elevation, which a Tiled spawn cannot hold`);
  if (extra.length > 0) refuse(`spawn "${id}" has ${extra.join(', ')}, which a Tiled spawn cannot hold`);
  const { name, prefab, ...rest } = object.props ?? {};
  if (Object.keys(rest).length > 0) refuse(`spawn "${id}" has props ${Object.keys(rest).join(', ')}`);
  if (name !== undefined && typeof name !== 'string') refuse(`spawn "${id}" name must be a string`);
  return {
    id: Number(tiledId),
    ...(name === undefined ? {} : { name }),
    x: object.pose.x * TILE_HEIGHT,
    y: object.pose.y * TILE_HEIGHT,
    ...(prefab === undefined ? {} : { properties: [{ name: 'prefab', value: prefab }] }),
  };
}

/**
 * Scene document to the Tiled subset `IsoMap` reads; `new IsoMap(sceneToIsoMap(doc))` is how a game loads a scene.
 * Refuses anything the map cannot hold (flips, objects outside the spawns layer, unknown tile props) rather than
 * dropping it. HD-2D settings are not map data: the game reads `doc.hd2d` itself.
 */
export function sceneToIsoMap(input: SceneDoc): TiledIsoMap {
  const doc = SceneDocSchema.parse(input);
  if (doc.packAdapter !== SMALLSCALEINT_SCENE_ADAPTER) refuse(`its pack adapter is ${doc.packAdapter}`);
  if (!doc.bounds) refuse('it has no bounds');
  const { width, height } = doc.bounds;
  const gids = new Map<string, number>();
  const tiles: TiledIsoMap['tilesets'][number]['tiles'] = [];
  const ordered = Object.entries(doc.layers).sort(([, a], [, b]) => a.order - b.order);
  const layers: TiledIsoMap['layers'] = ordered.map(([id, layer]) => {
    if (layer.kind === 'objects') {
      if (id !== SPAWNS_LAYER) refuse(`objects layer "${id}"; SmallScaleInt pieces are tiles`);
      const objects = Object.entries(doc.objects)
        .filter(([, object]) => object.layer === id)
        .map(([objectId, object]) => spawnOf(objectId, object))
        .sort((a, b) => a.id - b.id);
      return { type: 'objectgroup', name: id, objects };
    }
    const data = Array<number>(width * height).fill(0);
    for (const [cell, tile] of Object.entries(layer.tiles ?? {})) {
      const [x, y] = cell.split(',').map(Number) as [number, number];
      if (x < 0 || y < 0 || x >= width || y >= height) refuse(`tile ${id}:${cell} is outside ${width}x${height}`);
      if (tile.flip) refuse(`tile ${id}:${cell} is flipped; the pack draws facings instead`);
      const facing = (tile.facing ?? 'E') as TileFacing;
      if (!Object.hasOwn(ROTATION, facing)) refuse(`tile ${id}:${cell} facing ${tile.facing} is not E, N, W or S`);
      const { solid = defaultSolid(id.replace(/-\d+$/, '')), ...rest } = tile.props ?? {};
      if (typeof solid !== 'boolean') refuse(`tile ${id}:${cell} solid must be a boolean`);
      if (Object.keys(rest).length > 0) refuse(`tile ${id}:${cell} has props ${Object.keys(rest).join(', ')}`);
      const signature = JSON.stringify([tile.asset, facing, solid, tile.elevation ?? null]);
      let gid = gids.get(signature);
      if (gid === undefined) {
        gid = tiles.length + 1;
        gids.set(signature, gid);
        tiles.push({
          id: gid - 1,
          properties: [
            { name: 'asset', value: tile.asset },
            { name: 'rotation', value: ROTATION[facing] },
            { name: 'solid', value: solid },
            ...(tile.elevation === undefined ? [] : [{ name: 'elevation', value: tile.elevation }]),
          ],
        });
      }
      data[y * width + x] = gid;
    }
    return { type: 'tilelayer', name: tiledLayerName(id), width, height, data };
  });
  return {
    orientation: 'isometric',
    infinite: false,
    width,
    height,
    tilewidth: 128,
    tileheight: TILE_HEIGHT,
    layers,
    tilesets: [{ firstgid: 1, name: 'scene', tiles }],
  };
}
