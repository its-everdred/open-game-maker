import type Phaser from 'phaser';
import { AmbientLight, OrthographicCamera, PointLight, Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createLighting } from './create.js';
import { createPhaserLighting } from './phaser.js';
import { DEFAULT_FOREST_LIGHTING, type LightingPreset } from './schema.js';
import { createThreeLighting } from './three.js';

const preset: LightingPreset = {
  ...DEFAULT_FOREST_LIGHTING,
  lights: [{ id: 'lamp', x: 10, y: 20, radius: 40, color: '#ffcc88', intensity: 1 }],
};

describe('createLighting', () => {
  it('picks the backend from the target key', async () => {
    vi.resetModules();
    const phaser = vi.fn(() => 'phaser');
    const three = vi.fn(() => 'three');
    vi.doMock('./phaser.js', () => ({ createPhaserLighting: phaser }));
    vi.doMock('./three.js', () => ({ createThreeLighting: three }));
    const { createLighting: create } = await import('./create.js');
    const scene = {} as Phaser.Scene;
    const threeTarget = { renderer: {} as WebGLRenderer, scene: new Scene(), camera: new OrthographicCamera() };

    expect(create({ phaser: { scene } }, preset)).toBe('phaser');
    expect(phaser).toHaveBeenCalledWith({ scene }, preset, undefined);
    expect(create({ three: threeTarget }, preset, { quality: 'low' })).toBe('three');
    expect(three).toHaveBeenCalledWith(threeTarget, preset, { quality: 'low' });
    vi.doUnmock('./phaser.js');
    vi.doUnmock('./three.js');
  });

  it('rejects a target with no renderer', () => {
    expect(() => createLighting({} as never, preset)).toThrow(/phaser.*three/);
  });
});

describe("setQuality('off')", () => {
  it('removes every three.js light and the post pass', () => {
    const scene = new Scene();
    const ownAfterRender = scene.onAfterRender;
    const lighting = createThreeLighting(
      { renderer: {} as WebGLRenderer, scene, camera: new OrthographicCamera() },
      preset,
    );
    expect(scene.children.some((child) => child instanceof PointLight)).toBe(true);
    expect(scene.onAfterRender).not.toBe(ownAfterRender);

    lighting.setQuality('off');
    expect(scene.children.filter((child) => child instanceof PointLight || child instanceof AmbientLight)).toEqual([]);
    expect(scene.onAfterRender).toBe(ownAfterRender);
  });

  it('removes every Phaser light, overlay and grade filter', () => {
    const { scene, state } = fakePhaserScene();
    const lighting = createPhaserLighting({ scene }, preset);
    lighting.update(0);
    expect(state.lights).toHaveLength(1);
    expect(state.images).toHaveLength(2);
    expect(state.filters).toHaveLength(1);
    expect(state.enabled).toBe(true);

    lighting.setQuality('off');
    lighting.update(100);
    expect(state).toMatchObject({ lights: [], images: [], filters: [], textures: [], enabled: false });
  });
});

function fakePhaserScene() {
  const state = {
    enabled: false,
    lights: [] as object[],
    images: [] as object[],
    textures: [] as object[],
    filters: [] as object[],
  };
  const remove = <T>(list: T[], item: T) => list.splice(list.indexOf(item), 1);
  const chain = <T extends object>(target: T, names: string[]) => {
    for (const name of names) Object.assign(target, { [name]: () => target });
    return target;
  };
  const scene = {
    cameras: {
      main: {
        width: 640,
        height: 360,
        worldView: { x: 0, y: 0, width: 640, height: 360 },
        filters: {
          internal: {
            addColorMatrix() {
              const filter = { colorMatrix: { set: vi.fn() } };
              state.filters.push(filter);
              return filter;
            },
            remove: (filter: object) => remove(state.filters, filter),
          },
        },
      },
    },
    lights: {
      enable() {
        state.enabled = true;
        return this;
      },
      disable() {
        state.enabled = false;
        return this;
      },
      setAmbientColor() {
        return this;
      },
      addLight() {
        const light = chain({}, ['setPosition', 'setRadius', 'setColor', 'setIntensity']);
        state.lights.push(light);
        return light;
      },
      removeLight: (light: object) => remove(state.lights, light),
    },
    textures: {
      createCanvas(_key: string, width: number, height: number) {
        const canvas = Object.assign(document.createElement('canvas'), { width, height });
        const context = {
          createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: vi.fn(),
        };
        const texture = chain({ canvas, context, destroy: () => remove(state.textures, texture) }, [
          'setFilter',
          'refresh',
        ]);
        state.textures.push(texture);
        return texture;
      },
    },
    add: {
      image() {
        const image = chain({ destroy: () => remove(state.images, image) }, [
          'setOrigin',
          'setScrollFactor',
          'setDepth',
          'setDisplaySize',
          'setBlendMode',
        ]);
        state.images.push(image);
        return image;
      },
    },
  };
  return { scene: scene as unknown as Phaser.Scene, state };
}
