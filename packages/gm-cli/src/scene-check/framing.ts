import type { Grid } from './grid.js';
import { cellKey, type Camera, type Finding } from './model.js';
import { spawnOf } from './traverse.js';
import { viewSamples } from './view.js';

/** Relative difference allowed between the scene and the mock. */
export const FRAMING_TOLERANCE = 0.25;

export interface MockMeasure {
  /** Share of the mock that is scene rather than background void. */
  occupied: number;
  /** Character height as a share of the mock's height, when the worker measured it in the mock. */
  character?: number;
  /** The game's character height on screen at zoom 1, in pixels, measured in a render of the game. */
  characterHeight?: number;
}

/**
 * Share of an RGBA image that differs from its border colour (the void around a scene), so a mock and a frame
 * can be compared for how much of the screen the scene fills.
 */
export function occupiedShare(pixels: Uint8Array | Buffer, width: number, height: number): number {
  const at = (x: number, y: number) => (y * width + x) * 4;
  const counts = new Map<string, number>();
  const border = (x: number, y: number) => {
    const i = at(x, y);
    const key = `${pixels[i]! >> 4},${pixels[i + 1]! >> 4},${pixels[i + 2]! >> 4},${pixels[i + 3]! >> 6}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    border(x, 0);
    border(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    border(0, y);
    border(width - 1, y);
  }
  const [r, g, b, a] = [...counts]
    .sort((p, q) => q[1] - p[1])[0]![0]
    .split(',')
    .map((n) => Number(n));
  let filled = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const near =
      Math.abs((pixels[i]! >> 4) - r!) + Math.abs((pixels[i + 1]! >> 4) - g!) + Math.abs((pixels[i + 2]! >> 4) - b!) <=
        2 && pixels[i + 3]! >> 6 === a;
    if (!near) filled++;
  }
  return filled / (width * height);
}

const off = (ours: number, theirs: number) => Math.abs(ours - theirs) / Math.max(theirs, 1e-6);

/** The scene fills the frame and sizes its character like the approved mock. */
export function framing(grid: Grid, camera: Camera, mock: MockMeasure): Finding[] {
  const center = camera.center ?? spawnOf(grid.scene.actors);
  if (!center) return [];
  const samples = viewSamples(grid.scene, camera, center);
  const occupied = samples.filter((cell) => grid.floor.has(cellKey(cell))).length / samples.length;
  const findings: Finding[] = [];
  if (off(occupied, mock.occupied) > FRAMING_TOLERANCE) {
    findings.push({
      check: 'framing',
      id: 'framing/occupied',
      severity: 'medium',
      message: `scene fills ${Math.round(occupied * 100)}% of the frame; the mock fills ${Math.round(mock.occupied * 100)}%`,
      cells: [center],
      objects: [],
    });
  }
  if (mock.character === undefined || !mock.characterHeight) {
    findings.push({
      check: 'framing',
      id: 'framing/character-unmeasured',
      severity: 'info',
      message:
        'character height not compared: pass --mock-character <px> and --character-height <px>, each measured by eye',
      cells: [],
      objects: [],
    });
    return findings;
  }
  const character = (mock.characterHeight * camera.zoom) / camera.height;
  if (off(character, mock.character) > FRAMING_TOLERANCE) {
    findings.push({
      check: 'framing',
      id: 'framing/character-scale',
      severity: 'medium',
      message: `character stands ${Math.round(character * 100)}% of the frame's height; in the mock ${Math.round(mock.character * 100)}%`,
      cells: [center],
      objects: [],
    });
  }
  return findings;
}
