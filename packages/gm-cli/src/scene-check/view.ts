import type { Camera, Cell, Scene } from './model.js';
import { spawnOf } from './traverse.js';

/** Where the camera looks: its own centre, else the player spawn, else the middle of the map. */
export function frameCenter(scene: Scene, camera: Camera): Cell {
  const b = scene.bounds;
  return (
    camera.center ??
    spawnOf(scene.actors) ?? { x: Math.floor((b.minX + b.maxX) / 2), y: Math.floor((b.minY + b.maxY) / 2) }
  );
}

/** Sample points across the camera's view, each mapped to the grid cell under it (pixel-art steps of 4 px). */
export function viewSamples(scene: Scene, camera: Camera, center: Cell): Cell[] {
  const [tw, th] = scene.tile;
  const cx = ((center.x - center.y) * tw) / 2;
  const cy = ((center.x + center.y) * th) / 2 + th / 2;
  const halfW = camera.width / camera.zoom / 2;
  const halfH = camera.height / camera.zoom / 2;
  const step = 4 / camera.zoom;
  const cells: Cell[] = [];
  for (let sy = cy - halfH; sy < cy + halfH; sy += step) {
    for (let sx = cx - halfW; sx < cx + halfW; sx += step) {
      cells.push({ x: Math.floor(sx / tw + sy / th), y: Math.floor(sy / th - sx / tw) });
    }
  }
  return cells;
}
