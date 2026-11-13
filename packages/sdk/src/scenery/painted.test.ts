import { describe, expect, it, vi } from 'vitest';
import { ScenerySchema } from './data.js';
import { backdropRect, drawPaintedScenery, type PaintedImage } from './painted.js';

const scene = ScenerySchema.parse({
  version: 1,
  backdrop: {
    assetId: 'forest',
    landscape: { fit: 'cover', anchor: [0.5, 1] },
    portrait: { fit: 'contain', anchor: [0, 0.5] },
  },
  items: [
    { id: 'front', assetId: 'rock', position: [30, 40, 1], rotation: [0, 0, 0], scale: [1, 1, 1], layer: 'front' },
    {
      id: 'back',
      assetId: 'tree',
      position: [20, 30, 0],
      rotation: [0, 0, 0],
      scale: [2, 1, 1],
      layer: 'back',
      parallax: 0.5,
    },
  ],
  terrain: [],
  lighting: 'night',
  camera: { position: [0, 0, 1], target: [0, 0, 0], zoom: 1 },
});
const image = (name: string, width: number, height: number): PaintedImage => ({
  image: name as unknown as CanvasImageSource,
  width,
  height,
});

describe('painted scenery', () => {
  it('uses the aspect-specific fit and anchor', () => {
    expect(backdropRect(scene.backdrop!, image('forest', 100, 100), { width: 200, height: 100 })).toEqual({
      x: 0,
      y: -100,
      width: 200,
      height: 200,
    });
    expect(backdropRect(scene.backdrop!, image('forest', 100, 100), { width: 100, height: 200 })).toEqual({
      x: 0,
      y: 50,
      width: 100,
      height: 100,
    });
  });
  it('draws the backdrop before sorted items and applies camera parallax', () => {
    const context = {
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const images = new Map([
      ['forest', image('forest', 100, 100)],
      ['tree', image('tree', 10, 20)],
      ['rock', image('rock', 8, 8)],
    ]);
    drawPaintedScenery(context, scene, images, { width: 200, height: 100, cameraX: 10, cameraY: 4 });
    expect(vi.mocked(context.drawImage).mock.calls.map((call) => call[0])).toEqual(['forest', 'tree', 'rock']);
    expect(context.translate).toHaveBeenNthCalledWith(1, 15, 28);
    expect(context.translate).toHaveBeenNthCalledWith(2, 20, 36);
  });
});
