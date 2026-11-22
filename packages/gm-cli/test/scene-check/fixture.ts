import type { PackFacts } from '../../src/scene-check/facts.js';
import { readTiledScene } from '../../src/scene-check/read.js';
import type { Camera, Scene } from '../../src/scene-check/model.js';

/** Pack facts shaped like SmallScaleInt's measured ones: the fence and wall families draw opposite edge maps. */
export const pack: PackFacts = {
  set: 'test',
  tile: [128, 64],
  anchorY: 208,
  asset(id) {
    if (id === 'pack:fence') return { edges: { E: 'yMax', N: 'xMax', W: 'yMin', S: 'xMin' } };
    if (id === 'pack:wall' || id === 'pack:door') return { edges: { E: 'xMax', N: 'yMin', W: 'xMin', S: 'yMax' } };
    if (id === 'pack:bush') return { alpha: { E: [20, 120, 236, 230] }, size: [256, 256] };
    return undefined;
  },
};

const ROTATION = { E: 0, N: 90, W: 180, S: 270 } as const;

export interface Placed {
  layer: string;
  x: number;
  y: number;
  asset: string;
  facing?: keyof typeof ROTATION;
  solid?: boolean;
  tags?: string;
  elevation?: number;
}

export interface Fixture {
  width: number;
  height: number;
  pieces: Placed[];
  spawns: { name: string; x: number; y: number; prefab?: string }[];
}

/** A Tiled isometric map in the adapter's subset, one tile per distinct piece description. */
export function tiled(fixture: Fixture): unknown {
  const tiles: string[] = [];
  const layers = new Map<string, number[]>();
  for (const piece of fixture.pieces) {
    const { layer, x, y, ...tile } = piece;
    const id = JSON.stringify(tile);
    if (!tiles.includes(id)) tiles.push(id);
    if (!layers.has(layer)) layers.set(layer, Array<number>(fixture.width * fixture.height).fill(0));
    const data = layers.get(layer)!;
    if (data[y * fixture.width + x]) throw new Error(`fixture places two pieces on ${layer} ${x},${y}`);
    data[y * fixture.width + x] = tiles.indexOf(id) + 1;
  }
  return {
    orientation: 'isometric',
    width: fixture.width,
    height: fixture.height,
    tilewidth: 128,
    tileheight: 64,
    layers: [
      ...[...layers].map(([name, data]) => ({
        type: 'tilelayer',
        name,
        width: fixture.width,
        height: fixture.height,
        data,
      })),
      {
        type: 'objectgroup',
        name: 'spawns',
        objects: fixture.spawns.map((spawn, i) => ({
          id: i + 1,
          name: spawn.name,
          x: spawn.x,
          y: spawn.y,
          ...(spawn.prefab ? { properties: [{ name: 'prefab', value: spawn.prefab }] } : {}),
        })),
      },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'test',
        tiles: tiles.map((json, id) => {
          const tile = JSON.parse(json) as Omit<Placed, 'layer' | 'x' | 'y'>;
          return {
            id,
            properties: [
              { name: 'asset', value: tile.asset },
              { name: 'rotation', value: ROTATION[tile.facing ?? 'E'] },
              ...(tile.solid !== undefined ? [{ name: 'solid', value: tile.solid }] : []),
              ...(tile.tags ? [{ name: 'tags', value: tile.tags }] : []),
              ...(tile.elevation ? [{ name: 'elevation', value: tile.elevation }] : []),
            ],
          };
        }),
      },
    ],
  };
}

const PROPS: readonly [number, number][] = [
  [2, 2],
  [7, 2],
  [8, 3],
  [2, 7],
  [9, 8],
  [8, 9],
  [2, 9],
  [6, 3],
  [0, 0],
  [11, 0],
  [0, 6],
  [11, 4],
  [3, 11],
  [10, 11],
  [0, 11],
  [9, 5],
];

/**
 * A coherent 12x12 yard every check passes: a closed fence ring with a posted two-cell gate, a closed 2x2 house
 * with a roof and a south door, a paved path from the gate to the door, irregular dressing, a guard and a spawn.
 */
export function yard(): Fixture {
  const pieces: Placed[] = [];
  const path = new Set(['5,10', '5,9', '5,8', '5,7', '5,6', '5,5', '4,5', '3,5']);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      pieces.push({ layer: 'floor', x, y, asset: path.has(`${x},${y}`) ? 'pack:paving' : 'pack:grass' });
    }
  }
  const fence = (x: number, y: number, facing: Placed['facing'], layer = 'wall') =>
    pieces.push({ layer, x, y, asset: 'pack:fence', facing, solid: true });
  for (let i = 1; i <= 10; i++) {
    fence(i, 1, 'W'); // yMin
    if (i !== 5 && i !== 6) fence(i, 10, 'E'); // yMax, leaving the gate
    if (i !== 1) fence(1, i, 'S', i === 10 ? 'decor' : 'wall'); // xMin
    if (i !== 1) fence(10, i, 'N', i === 10 ? 'decor' : 'wall'); // xMax
  }
  fence(1, 1, 'S', 'decor');
  fence(10, 1, 'N', 'decor');
  pieces.push({ layer: 'decor', x: 4, y: 10, asset: 'pack:post', solid: true });
  pieces.push({ layer: 'decor', x: 7, y: 10, asset: 'pack:post', solid: true });
  const wall = (x: number, y: number, facing: Placed['facing'], layer: string) =>
    pieces.push({ layer, x, y, asset: 'pack:wall', facing, solid: true });
  wall(3, 3, 'N', 'wall');
  wall(3, 3, 'W', 'wall2');
  wall(4, 3, 'N', 'wall');
  wall(4, 3, 'E', 'wall2');
  wall(3, 4, 'W', 'wall');
  pieces.push({ layer: 'wall2', x: 3, y: 4, asset: 'pack:door', facing: 'S', solid: false });
  wall(4, 4, 'E', 'wall');
  wall(4, 4, 'S', 'wall2');
  for (const [x, y] of [
    [3, 3],
    [4, 3],
    [3, 4],
    [4, 4],
  ] as const)
    pieces.push({ layer: 'roof', x, y, asset: 'pack:roof' });
  for (const [x, y] of PROPS) pieces.push({ layer: 'decor', x, y, asset: 'pack:flower', solid: false });
  return {
    width: 12,
    height: 12,
    pieces,
    spawns: [
      { name: 'player', x: 5, y: 11, prefab: 'player' },
      { name: 'guard', x: 7, y: 7 },
    ],
  };
}

export const scene = (fixture: Fixture, lock = {}): Scene => readTiledScene([{ json: tiled(fixture) }], pack, lock);

/** A small frame over the yard's middle, so the clean yard shows no void. */
export const camera: Camera = { width: 300, height: 300, zoom: 1, center: { x: 6, y: 6 } };

/** Remove pieces matching a predicate (for breaking the clean yard one defect at a time). */
export function without(fixture: Fixture, match: (piece: Placed) => boolean): Fixture {
  return { ...fixture, pieces: fixture.pieces.filter((piece) => !match(piece)) };
}
