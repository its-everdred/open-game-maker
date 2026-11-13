import type { AssetLoader } from '@gm/sdk/assets';
import { Group, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESIGN, type LevelDesign } from '../src/game.js';
import { attachScenery } from '../src/scenery.js';

afterEach(() => vi.unstubAllGlobals());

describe('painted scenery in the 3D template', () => {
  it('loads the locked backdrop and sprite, projects and picks the item, and restores the scene on disposal', async () => {
    const drawImage = vi.fn();
    const context = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      drawImage,
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
    };
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
    class FakeImage {
      naturalWidth = 100;
      naturalHeight = 100;
      onload?: () => void;
      onerror?: () => void;
      set src(_url: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const scene = new Scene();
    const resolve = vi.fn((id: string) => ({ url: `/assets/${id}.${id === 'rock' ? 'glb' : 'png'}` }));
    const object = vi.fn(async () => new Group());
    const loader = { resolve, object } as unknown as AssetLoader;
    const renderer = attachScenery(scene, loader, 12);
    const id = 'e_01K8ZTEMP00000000000000001';
    const rock = 'e_01K8ZTEMP00000000000000002';
    const backdrop = {
      assetId: 'forest',
      landscape: { fit: 'cover', anchor: [0.5, 0.5] },
      portrait: { fit: 'contain', anchor: [0.5, 0.5] },
    };
    const design = {
      ...DEFAULT_DESIGN,
      globals: {
        ...DEFAULT_DESIGN.globals,
        'scenery.backdrop': backdrop,
        'scenery.settings': {
          version: 1,
          terrain: [],
          lighting: 'night',
          camera: { position: [0, 0, 1], target: [0, 0, 0], zoom: 1 },
        },
      },
      entities: {
        ...DEFAULT_DESIGN.entities,
        [id]: {
          id,
          prefab: 'scenery:tree',
          level: 'main',
          origin: 'creator',
          props: { pose: { position: [200, 180, 0] } },
        },
        [rock]: {
          id: rock,
          prefab: 'scenery:rock',
          level: 'main',
          origin: 'creator',
          props: { pose: { position: [8, 0, 0] } },
        },
      },
    } as LevelDesign;
    await renderer.update(design);
    expect(resolve).toHaveBeenCalledWith('forest');
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(object).toHaveBeenCalledWith('rock');
    expect(scene.getObjectByName('scenery')?.children.some((child) => child.userData.entityId === rock)).toBe(true);
    expect(renderer.isPainted()).toBe(true);
    expect(renderer.pick(200 / 640, 180 / 480)).toEqual([{ kind: 'entity', id }]);
    expect(renderer.project(0.5, 0.5)).toEqual([320, 240, 0]);
    expect(renderer.screen(id)).toEqual({ x: 200 / 640, y: 180 / 480 });
    renderer.draw(10, 20);
    renderer.draw(20, 30);
    expect(renderer.pick(190 / 640, 170 / 480)).toEqual([{ kind: 'entity', id }]);
    expect(renderer.screen(id)).toEqual({ x: 190 / 640, y: 170 / 480 });
    renderer.resize(480, 640);
    expect(renderer.project(0.5, 0.5)).toEqual([330, 250, 0]);
    expect(renderer.project(0.5, 0)).toBeNull();
    const portraitPoint = renderer.screen(id)!;
    expect(renderer.pick(portraitPoint.x, portraitPoint.y)).toEqual([{ kind: 'entity', id }]);
    renderer.dispose();
    expect(scene.background).toBeNull();
  });
});
