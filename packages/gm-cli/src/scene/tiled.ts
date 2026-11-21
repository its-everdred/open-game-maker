import type { PlannedObject } from './plan.js';

type Tile = { id: number; properties: { name: string; value: string | number | boolean }[] };
export type SceneTile = { object: PlannedObject; rotation: 0 | 90 | 180 | 270; solid: boolean };

/** Build a SmallScaleInt-compatible decor layer; callers must install it in a game that consumes Tiled maps. */
export function sceneDecorLayer(
  width: number,
  height: number,
  firstgid: number,
  placements: readonly SceneTile[],
  lockedAssets: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
) {
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    width * height > 1_000_000 ||
    !Number.isSafeInteger(firstgid) ||
    firstgid < 1 ||
    firstgid + placements.length > 0x1fffffff
  )
    throw new Error('invalid tile map bounds');
  const data = Array<number>(width * height).fill(0);
  const tiles: Tile[] = [];
  for (const { object, rotation, solid } of placements) {
    const { x, y } = object.position;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= width || y >= height)
      throw new Error(`placement is outside the tile grid: ${object.id}`);
    if (!lockedAssets.has(object.selectedAsset)) throw new Error(`asset is not locked: ${object.selectedAsset}`);
    if (![0, 90, 180, 270].includes(rotation) || typeof solid !== 'boolean') throw new Error('invalid tile properties');
    if (reserved.has(`${x},${y}`)) throw new Error(`placement occupies a reserved cell: ${object.id}`);
    const index = y * width + x;
    if (data[index] !== 0) throw new Error(`multiple placements share a cell: ${object.id}`);
    const id = tiles.length;
    tiles.push({
      id,
      properties: [
        { name: 'asset', value: object.selectedAsset },
        { name: 'rotation', value: rotation },
        { name: 'solid', value: solid },
      ],
    });
    data[index] = firstgid + id;
  }
  return {
    layer: { type: 'tilelayer' as const, name: 'decor', width, height, data },
    tileset: { firstgid, name: 'scene-clone', tiles },
  };
}
