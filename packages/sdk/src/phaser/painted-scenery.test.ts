import { afterEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { ScenerySchema } from '../scenery/data.js';
import { createPaintedScenery } from './painted-scenery.js';

afterEach(() => vi.unstubAllGlobals());

describe('Phaser painted scenery', () => {
  it('loads locked image URLs, positions and layers the objects, and disposes them', async () => {
    class FakeImage {
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const made: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
    const makeObject = () => {
      const object: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const name of [
        'setOrigin',
        'setScrollFactor',
        'setDepth',
        'setPosition',
        'setDisplaySize',
        'setScale',
        'setRotation',
        'setData',
      ])
        object[name] = vi.fn().mockReturnValue(object);
      object.destroy = vi.fn();
      Object.assign(object, { texture: { getSourceImage: () => ({ width: 100, height: 100 }) } });
      made.push(object);
      return object;
    };
    const remove = vi.fn();
    const scene = {
      add: { image: vi.fn(makeObject) },
      cameras: { main: { width: 200, height: 100 } },
      textures: { addImage: vi.fn(), remove },
    } as unknown as Phaser.Scene;
    const resolve = vi.fn((id: string) => `/assets/${id}.png`);
    const scenery = createPaintedScenery(scene, resolve);
    await scenery.update(
      ScenerySchema.parse({
        version: 1,
        backdrop: {
          assetId: 'forest',
          landscape: { fit: 'cover', anchor: [0.5, 1] },
          portrait: { fit: 'contain', anchor: [0.5, 0.5] },
        },
        items: [
          {
            id: 'oak',
            assetId: 'tree',
            position: [20, 30, 4],
            rotation: [0, 0, 0],
            scale: [2, 1, 1],
            layer: 'mid',
            parallax: 0.5,
          },
        ],
        terrain: [],
        lighting: 'night',
        camera: { position: [0, 0, 1], target: [0, 0, 0], zoom: 1 },
      }),
    );
    expect(resolve.mock.calls.map(([id]) => id)).toEqual(['tree', 'forest']);
    expect(made[0]!.setPosition).toHaveBeenCalledWith(0, -100);
    expect(made[1]!.setScrollFactor).toHaveBeenCalledWith(0.5);
    expect(made[1]!.setDepth).toHaveBeenCalledWith(-99999);
    scenery.dispose();
    expect(made[0]!.destroy).toHaveBeenCalled();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
