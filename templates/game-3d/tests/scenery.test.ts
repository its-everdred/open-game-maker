import type { AssetLoader } from '@gm/sdk/assets';
import { BoxGeometry, Mesh, MeshBasicMaterial, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createGame, DEFAULT_DESIGN } from '../src/game.js';
import { attachScenery } from '../src/scenery.js';

const id = 'e_01K8ZTEMP00000000000000001';
const input = {
  ...DEFAULT_DESIGN,
  globals: {
    ...DEFAULT_DESIGN.globals,
    'scenery.settings': {
      version: 1,
      terrain: [],
      lighting: 'night',
      camera: { position: [0, 8, 8], target: [0, 0, 0], zoom: 1 },
    },
  },
  entities: {
    ...DEFAULT_DESIGN.entities,
    [id]: { id, prefab: 'scenery:tree', level: 'main', origin: 'creator', props: { pose: { position: [8, 0, 0] } } },
  },
};

describe('template scenery integration', () => {
  it('preserves editable scenery and displays only assets outside the play area', async () => {
    const game = createGame();
    const design = game.module.designSchema.parse(input);
    expect(design.globals).toHaveProperty('scenery.settings');
    expect(design.entities[id]?.prefab).toBe('scenery:tree');
    const scene = new Scene();
    const loader = {
      resolve: vi.fn(),
      object: vi.fn(async () => new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())),
    } as unknown as AssetLoader;
    const scenery = attachScenery(scene, loader, 12);
    await scenery.update(design);
    const root = scene.children.find((child) => child.name === 'scenery')!;
    expect(root.children.find((child) => child.userData.entityId === id)?.position.x).toBe(8);
    const moved = structuredClone(design);
    moved.entities[id]!.props.pose = { position: [0, 0, 0] };
    await scenery.update(moved);
    expect(
      scene.children
        .find((child) => child.name === 'scenery')!
        .children.some((child) => child.userData.entityId === id),
    ).toBe(false);
    scenery.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
