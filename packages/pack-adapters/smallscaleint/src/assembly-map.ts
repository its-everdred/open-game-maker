import type { Layer } from './conventions.js';
import type { TileFacing, TiledIsoMap } from './map.js';
import type { Cell } from './placement.js';

export interface AssemblyPlacement {
  cell: Cell;
  layer: Layer;
  asset: string;
  facing: TileFacing;
  solid: boolean;
}

const LAYERS = ['floor', 'wall', 'decor', 'roof'] as const satisfies readonly Layer[];
const ROTATION: Record<TileFacing, number> = { E: 0, N: 90, W: 180, S: 270 };

/** Build the finite Tiled subset read by IsoMap. Conflicting placements are rejected, never dropped. */
export function assemblyMap(width: number, height: number, placements: readonly AssemblyPlacement[]): TiledIsoMap {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('map dimensions must be positive integers');
  }
  const layers = LAYERS.map((name) => ({
    type: 'tilelayer' as const,
    name,
    width,
    height,
    data: Array<number>(width * height).fill(0),
  }));
  const byKey = new Map<string, number>();
  const tiles: NonNullable<TiledIsoMap['tilesets'][number]['tiles']> = [];
  for (const placement of placements) {
    const { x, y } = placement.cell;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
      throw new Error(`placement ${x},${y} is outside the map`);
    }
    if (typeof placement.asset !== 'string' || !placement.asset) throw new Error('placement asset must not be empty');
    if (typeof placement.solid !== 'boolean') throw new Error('placement solid must be a boolean');
    const layer = layers.find((candidate) => candidate.name === placement.layer);
    if (!layer || !Object.hasOwn(ROTATION, placement.facing)) throw new Error('invalid placement layer or facing');
    const index = y * width + x;
    if (layer.data[index] !== 0) throw new Error(`multiple ${placement.layer} placements at ${x},${y}`);
    const signature = JSON.stringify([placement.asset, placement.facing, placement.solid]);
    let gid = byKey.get(signature);
    if (gid === undefined) {
      gid = tiles.length + 1;
      byKey.set(signature, gid);
      tiles.push({
        id: gid - 1,
        properties: [
          { name: 'asset', value: placement.asset },
          { name: 'rotation', value: ROTATION[placement.facing] },
          { name: 'solid', value: placement.solid },
        ],
      });
    }
    layer.data[index] = gid;
  }
  return {
    orientation: 'isometric',
    infinite: false,
    width,
    height,
    tilewidth: 128,
    tileheight: 64,
    layers: [...layers, { type: 'objectgroup', name: 'spawns', objects: [] }],
    tilesets: [{ firstgid: 1, name: 'assembly', tiles }],
  };
}
