import type { PlannedObject } from './plan.js';

type Tile = { id: number; properties: { name: string; value: string | number | boolean }[] };
export type SceneTile = {
  object: PlannedObject;
  rotation: 0 | 90 | 180 | 270;
  solid: boolean;
  /** Reviewed grid offsets already rotated into the selected facing, including the anchor. */
  footprint: readonly { x: number; y: number }[];
};

/** Build a decor layer. The game must consume it and enforce full-footprint collision itself. */
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
  const occupied = new Set<string>();
  for (const { object, rotation, solid, footprint } of placements) {
    const { x, y } = object.position;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= width || y >= height)
      throw new Error(`placement is outside the tile grid: ${object.id}`);
    if (!lockedAssets.has(object.selectedAsset)) throw new Error(`asset is not locked: ${object.selectedAsset}`);
    if (![0, 90, 180, 270].includes(rotation) || typeof solid !== 'boolean') throw new Error('invalid tile properties');
    if (!Array.isArray(footprint) || footprint.length === 0 || footprint.length > width * height)
      throw new Error(`invalid footprint: ${object.id}`);
    const cells = new Set<string>();
    for (const offset of footprint) {
      if (!Number.isSafeInteger(offset.x) || !Number.isSafeInteger(offset.y))
        throw new Error(`invalid footprint: ${object.id}`);
      const cx = x + offset.x,
        cy = y + offset.y,
        key = `${cx},${cy}`;
      if (
        !Number.isSafeInteger(cx) ||
        !Number.isSafeInteger(cy) ||
        cx < 0 ||
        cy < 0 ||
        cx >= width ||
        cy >= height ||
        cells.has(key)
      )
        throw new Error(`invalid footprint: ${object.id}`);
      if (reserved.has(key)) throw new Error(`placement occupies a reserved cell: ${object.id}`);
      if (occupied.has(key)) throw new Error(`multiple placements share a cell: ${object.id}`);
      cells.add(key);
    }
    if (!cells.has(`${x},${y}`)) throw new Error(`footprint omits its anchor: ${object.id}`);
    for (const cell of cells) occupied.add(cell);
    const index = y * width + x;
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
