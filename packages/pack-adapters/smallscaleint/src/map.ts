import type { AssetLoader } from '@gm/sdk/assets';
import type Phaser from 'phaser';
import { z } from 'zod';

import { type Layer } from './conventions.js';

const TILE_WIDTH = 128;
const TILE_HEIGHT = 64;
const GID_MASK = 0x1fffffff;
let floorTextureSerial = 0;
const LAYERS = ['floor', 'wall', 'decor', 'roof'] as const satisfies readonly Layer[];
const FACINGS = { 0: 'E', 90: 'N', 180: 'W', 270: 'S' } as const;
const LAYER_DEPTH: Record<Layer, number> = { floor: 0, wall: 0.1, decor: 0.2, roof: 0.3 };

const propertySchema = z.object({ name: z.string(), value: z.unknown() });
const tileLayerSchema = z.object({
  type: z.literal('tilelayer'),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  data: z.array(z.number().int().nonnegative()),
});
const objectSchema = z.object({
  id: z.number().int(),
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  properties: z.array(propertySchema).optional(),
});
const objectLayerSchema = z.object({
  type: z.literal('objectgroup'),
  name: z.string(),
  objects: z.array(objectSchema),
});
const tiledMapSchema = z.object({
  orientation: z.string(),
  infinite: z.boolean().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  layers: z.array(z.discriminatedUnion('type', [tileLayerSchema, objectLayerSchema])),
  tilesets: z.array(
    z.object({
      firstgid: z.number().int().positive(),
      name: z.string(),
      tiles: z.array(
        z.object({
          id: z.number().int().nonnegative(),
          properties: z.array(propertySchema).optional(),
        }),
      ),
    }),
  ),
});

export type TiledIsoMap = z.input<typeof tiledMapSchema>;
export type TileFacing = (typeof FACINGS)[keyof typeof FACINGS];

export interface IsoPoint {
  x: number;
  y: number;
}

export interface IsoPiece {
  key: string;
  layer: Layer;
  x: number;
  y: number;
  gid: number;
  asset: string;
  facing: TileFacing;
  depth: number;
  /** Height above the tile in 64-pixel grid units. */
  elevation?: number;
  solid: boolean;
  visible: boolean;
}

export interface IsoPieceState {
  solid?: boolean;
  visible?: boolean;
}

export interface IsoSpawn {
  id: number;
  name?: string;
  prefab?: string;
  x: number;
  y: number;
}

export interface RenderedIsoSprite {
  key: string;
  object: Phaser.GameObjects.Image;
}

export interface RenderedIsoMap {
  floor?: Phaser.Tilemaps.TilemapLayer;
  sprites: RenderedIsoSprite[];
}

function property(properties: z.infer<typeof propertySchema>[] | undefined, name: string): unknown {
  return properties?.find((candidate) => candidate.name === name)?.value;
}

/** Top point of an isometric tile in an origin-free 128x64 diamond projection. */
export function isoToWorld(x: number, y: number): IsoPoint {
  return { x: (x - y) * (TILE_WIDTH / 2), y: (x + y) * (TILE_HEIGHT / 2) };
}

/** Exact inverse of {@link isoToWorld}; fractional coordinates are preserved for grid-edge placement. */
export function worldToIso(x: number, y: number): IsoPoint {
  return { x: x / TILE_WIDTH + y / TILE_HEIGHT, y: y / TILE_HEIGHT - x / TILE_WIDTH };
}

function facingOf(value: unknown, gid: number): TileFacing {
  const rotation = value ?? 0;
  if (typeof rotation !== 'number' || !Number.isInteger(rotation)) {
    throw new Error(`tile gid ${gid} rotation must be one of 0, 90, 180, 270`);
  }
  const normalized = ((rotation % 360) + 360) % 360;
  const facing = FACINGS[normalized as keyof typeof FACINGS];
  if (!facing) throw new Error(`tile gid ${gid} rotation must be one of 0, 90, 180, 270`);
  return facing;
}

function keyOf(layer: string, x: number, y: number): string {
  return `${layer}:${x},${y}`;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Waits for this map's queued images only; another file failing in the same loader batch is unrelated. */
function loadImages(scene: Phaser.Scene, keys: ReadonlySet<string>): Promise<void> {
  if (keys.size === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const failed: string[] = [];
    const onError = (file: { key: string; src?: string }) => {
      if (keys.has(file.key)) failed.push(`${file.key} (${file.src ?? 'no url'})`);
    };
    scene.load.on('loaderror', onError);
    scene.load.once('complete', () => {
      scene.load.off('loaderror', onError);
      if (failed.length > 0) reject(new Error(`Failed to load isometric pieces: ${failed.join(', ')}`));
      else resolve();
    });
    scene.load.start();
  });
}

/** Parsed, engine-neutral state for the finite SmallScaleInt Tiled subset. */
export class IsoMap {
  readonly width: number;
  readonly height: number;
  readonly spawns: readonly IsoSpawn[];
  readonly #basePieces: readonly IsoPiece[];
  readonly #baseByKey = new Map<string, IsoPiece>();
  readonly #state = new Map<string, Required<IsoPieceState>>();
  readonly #rendered = new Map<string, Phaser.GameObjects.Image>();
  #floor?: Phaser.Tilemaps.TilemapLayer;

  constructor(json: unknown) {
    const map = tiledMapSchema.parse(json);
    if (map.orientation !== 'isometric') throw new Error('map orientation must be isometric');
    if (map.infinite === true) throw new Error('map must be finite');
    if (map.tilewidth !== TILE_WIDTH || map.tileheight !== TILE_HEIGHT) {
      throw new Error(`map tiles are ${map.tilewidth}x${map.tileheight}; SmallScaleInt maps must be 128x64`);
    }
    this.width = map.width;
    this.height = map.height;

    const tileByGid = new Map<number, { properties?: z.infer<typeof propertySchema>[] }>();
    for (const tileset of map.tilesets) {
      for (const tile of tileset.tiles) {
        const gid = tileset.firstgid + tile.id;
        if (tileByGid.has(gid)) throw new Error(`tile gid ${gid} appears in more than one tileset`);
        tileByGid.set(gid, tile);
      }
    }

    const pieces: IsoPiece[] = [];
    const spawns: IsoSpawn[] = [];
    const seenLayers = new Set<string>();
    for (const layer of map.layers) {
      if (seenLayers.has(layer.name)) throw new Error(`layer "${layer.name}" appears twice`);
      seenLayers.add(layer.name);
      if (layer.type === 'objectgroup') {
        if (layer.name !== 'spawns') throw new Error(`object layer "${layer.name}" is not the spawns layer`);
        for (const object of layer.objects) {
          const prefab = property(object.properties, 'prefab');
          if (prefab !== undefined && typeof prefab !== 'string') {
            throw new Error(`spawn ${object.id} prefab must be a string`);
          }
          spawns.push({
            id: object.id,
            ...(object.name ? { name: object.name } : {}),
            ...(typeof prefab === 'string' ? { prefab } : {}),
            x: object.x,
            y: object.y,
          });
        }
        continue;
      }

      const extraLayer = /^(wall|decor|roof)#[1-9]\d*$/.exec(layer.name);
      if (!(LAYERS as readonly string[]).includes(layer.name) && !extraLayer) {
        throw new Error(`tile layer "${layer.name}" is not one of ${LAYERS.join(', ')} or a numbered sprite layer`);
      }
      if (layer.width !== map.width || layer.height !== map.height || layer.data.length !== map.width * map.height) {
        throw new Error(`tile layer "${layer.name}" does not cover the ${map.width}x${map.height} map`);
      }
      const name = (extraLayer?.[1] ?? layer.name) as Layer;
      layer.data.forEach((storedGid, index) => {
        if (storedGid === 0) return;
        if (storedGid > GID_MASK) throw new Error(`tile layer "${name}" uses unsupported Tiled transform flags`);
        const tile = tileByGid.get(storedGid);
        if (!tile) throw new Error(`tile gid ${storedGid} has no asset binding in this map`);
        const asset = property(tile.properties, 'asset');
        if (typeof asset !== 'string' || asset.length === 0) {
          throw new Error(`tile gid ${storedGid} asset must be a non-empty lock id`);
        }
        const explicitSolid = property(tile.properties, 'solid');
        if (explicitSolid !== undefined && typeof explicitSolid !== 'boolean') {
          throw new Error(`tile gid ${storedGid} solid must be a boolean`);
        }
        const elevation = property(tile.properties, 'elevation');
        if (
          elevation !== undefined &&
          (typeof elevation !== 'number' || !Number.isFinite(elevation) || elevation < 0)
        ) {
          throw new Error(`tile gid ${storedGid} elevation must be a non-negative finite number`);
        }
        if (name === 'floor' && elevation !== undefined && elevation !== 0) {
          throw new Error('floor tiles cannot have elevation');
        }
        const x = index % map.width;
        const y = Math.floor(index / map.width);
        const solid = typeof explicitSolid === 'boolean' ? explicitSolid : name === 'wall';
        pieces.push({
          key: keyOf(layer.name, x, y),
          layer: name,
          x,
          y,
          gid: storedGid,
          asset,
          facing: facingOf(property(tile.properties, 'rotation'), storedGid),
          depth: this.depthOf(x, y, name),
          ...(typeof elevation === 'number' ? { elevation } : {}),
          solid,
          visible: true,
        });
      });
    }

    for (const required of [...LAYERS, 'spawns']) {
      if (!seenLayers.has(required)) throw new Error(`map is missing required layer "${required}"`);
    }

    this.#basePieces = pieces;
    this.spawns = spawns;
    for (const piece of pieces) {
      this.#baseByKey.set(piece.key, piece);
      this.#state.set(piece.key, { solid: piece.solid, visible: piece.visible });
    }
  }

  /** Current pieces in stable Tiled order. */
  pieces(layer?: Layer): IsoPiece[] {
    return this.#basePieces
      .filter((piece) => layer === undefined || piece.layer === layer)
      .map((piece) => ({ ...piece, ...this.#state.get(piece.key)! }));
  }

  hasFloor(x: number, y: number): boolean {
    return this.#basePieces.some(
      (piece) => piece.layer === 'floor' && piece.x === x && piece.y === y && this.#state.get(piece.key)!.visible,
    );
  }

  /** Projected footprint sort key; layer bias is deterministic for pieces sharing a cell. */
  depthOf(x: number, y: number, layer: Layer): number {
    return isoToWorld(x, y).y + LAYER_DEPTH[layer];
  }

  /** Applies game-owned door/destructible state without assigning gameplay meaning to an asset. */
  sync(overrides: Readonly<Record<string, IsoPieceState>>): void {
    for (const [key, override] of Object.entries(overrides)) {
      const current = this.#state.get(key);
      if (!current) throw new Error(`unknown isometric piece ${key}`);
      const next = {
        solid: override.solid ?? current.solid,
        visible: override.visible ?? current.visible,
      };
      if (next.solid === current.solid && next.visible === current.visible) continue;
      this.#state.set(key, next);
      if (next.visible !== current.visible) {
        const piece = this.#baseByKey.get(key)!;
        if (piece.layer === 'floor' && this.#floor) {
          if (next.visible) this.#floor.putTileAt(piece.gid, piece.x, piece.y);
          else this.#floor.removeTileAt(piece.x, piece.y);
        } else {
          this.#rendered.get(key)?.setVisible(next.visible);
        }
      }
    }
  }

  /** `[y][x]` is true for a currently visible, solid wall piece. */
  collisionGrid(): boolean[][] {
    const grid = Array.from({ length: this.height }, () => Array<boolean>(this.width).fill(false));
    for (const piece of this.#basePieces) {
      const state = this.#state.get(piece.key)!;
      if (piece.layer === 'wall' && state.visible && state.solid) grid[piece.y]![piece.x] = true;
    }
    return grid;
  }

  /** Visible roof pieces occupying a tile, for a game-owned cutaway policy. */
  roofTilesAbove(x: number, y: number): IsoPiece[] {
    return this.#basePieces
      .filter(
        (piece) => piece.layer === 'roof' && piece.x === x && piece.y === y && this.#state.get(piece.key)!.visible,
      )
      .map((piece) => ({ ...piece, ...this.#state.get(piece.key)! }));
  }

  /** Binds the floor to a Phaser isometric Tilemap and every taller layer to depth-sorted facing images. */
  async render(scene: Phaser.Scene, loader: AssetLoader): Promise<RenderedIsoMap> {
    this.#floor = undefined;
    this.#rendered.clear();
    const texturePieces = this.pieces();
    const queued = new Set<string>();
    for (const piece of texturePieces) {
      const texture = `${piece.asset}:${piece.facing}`;
      if (scene.textures.exists(texture) || queued.has(texture)) continue;
      const resolved = loader.resolve(piece.asset);
      const facingPath = resolved.meta?.sprite?.facings?.[piece.facing];
      if (!facingPath) throw new Error(`Asset ${piece.asset} has no ${piece.facing} isometric facing`);
      scene.load.image(texture, new URL(basename(facingPath), resolved.url).toString());
      queued.add(texture);
    }
    await loadImages(scene, queued);

    const all = this.pieces();
    const floorPieces = all.filter((piece) => piece.layer === 'floor');
    let floor: Phaser.Tilemaps.TilemapLayer | undefined;
    if (floorPieces.length > 0) {
      // Phaser caches coordinate-conversion functions in its Tilemap constructor.
      // Seed a minimal Tiled map so isometric conversion and culling agree with the layer.
      const serial = floorTextureSerial++;
      const mapKey = `smallscaleint-map:${serial}`;
      scene.cache.tilemap.add(mapKey, {
        format: 1, // Phaser.Tilemaps.Formats.TILED_JSON
        data: {
          orientation: 'isometric',
          width: this.width,
          height: this.height,
          tilewidth: TILE_WIDTH,
          tileheight: TILE_HEIGHT,
          layers: [],
          tilesets: [],
        },
      });
      let tilemap: Phaser.Tilemaps.Tilemap;
      try {
        tilemap = scene.make.tilemap({ key: mapKey });
      } finally {
        scene.cache.tilemap.remove(mapKey);
      }
      // The map has no predeclared Tiled tilesets; allow addTilesetImage to bind
      // the runtime textures while retaining the constructor's isometric converters.
      tilemap.format = 2; // Phaser.Tilemaps.Formats.ARRAY_2D
      const byGid = new Map<number, IsoPiece>();
      for (const piece of floorPieces) if (!byGid.has(piece.gid)) byGid.set(piece.gid, piece);
      const sources = [...byGid.values()].map((piece) => ({
        piece,
        texture: scene.textures.get(`${piece.asset}:${piece.facing}`),
      }));
      const imageWidth = sources.reduce((width, source) => Math.max(width, source.texture.getSourceImage().width), 0);
      const imageHeight = sources.reduce(
        (height, source) => Math.max(height, source.texture.getSourceImage().height),
        0,
      );
      const textureKeys: string[] = [];
      const tilesets = sources.map(({ piece, texture }) => {
        const image = texture.getSourceImage();
        // Phaser handles tile offsets differently in Canvas and WebGL, and its WebGL
        // offsets do not scale with the layer. Center each source on a common canvas.
        const key = `smallscaleint-floor:${serial}:${piece.gid}`;
        const normalized = scene.textures.createCanvas(key, imageWidth, imageHeight);
        if (!normalized) throw new Error(`could not create texture for tile gid ${piece.gid}`);
        textureKeys.push(key);
        normalized.getContext().drawImage(image as CanvasImageSource, (imageWidth - image.width) / 2, 0);
        normalized.refresh();
        normalized.setFilter(texture.source[0]!.scaleMode);
        const tileset = tilemap.addTilesetImage(`gid-${piece.gid}`, key, imageWidth, imageHeight, 0, 0, piece.gid);
        if (!tileset) throw new Error(`texture for tile gid ${piece.gid} is not loaded`);
        return tileset;
      });
      floor = tilemap.createBlankLayer('floor', tilesets) ?? undefined;
      if (!floor) throw new Error('could not create isometric floor layer');
      const rows = Array.from({ length: this.height }, () => Array<number>(this.width).fill(-1));
      for (const piece of floorPieces) if (piece.visible) rows[piece.y]![piece.x] = piece.gid;
      floor.putTilesAt(rows, 0, 0);
      floor.setPosition(this.height * (TILE_WIDTH / 2) - imageWidth / 2, TILE_HEIGHT - 208).setDepth(-1);
      // The layer origin is the image's top-left; include the full image in camera culling.
      floor.setCullPadding(Math.ceil(imageWidth / TILE_WIDTH) + 1, Math.ceil(imageHeight / TILE_HEIGHT) + 1);
      floor.once('destroy', () => {
        for (const key of textureKeys) scene.textures.remove(key);
      });
      this.#floor = floor;
    }

    const sprites = all
      .filter((piece) => piece.layer !== 'floor')
      .sort((a, b) => a.depth - b.depth || a.x - b.x)
      .map((piece) => {
        const point = isoToWorld(piece.x, piece.y);
        const object = scene.add
          .image(
            this.height * (TILE_WIDTH / 2) + point.x,
            TILE_HEIGHT + point.y - (piece.elevation ?? 0) * TILE_HEIGHT,
            `${piece.asset}:${piece.facing}`,
          )
          .setOrigin(0.5, 208 / scene.textures.get(`${piece.asset}:${piece.facing}`).getSourceImage().height)
          .setDepth(piece.depth)
          .setVisible(piece.visible);
        this.#rendered.set(piece.key, object);
        return { key: piece.key, object };
      });
    return { ...(floor ? { floor } : {}), sprites };
  }
}
