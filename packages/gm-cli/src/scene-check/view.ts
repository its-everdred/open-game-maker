import type { Camera, Cell, Scene } from './model.js';

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
