import { Group, Mesh } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ScenerySchema } from './data.js';
import { createSceneryController } from './controller.js';

const base = ScenerySchema.parse({
  version: 1,
  items: [{ id: 'tree', assetId: 'tree', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], layer: 'mid' }],
  terrain: [],
  lighting: 'night',
  camera: { position: [0, 5, 5], target: [0, 0, 0], zoom: 1 },
});

describe('scenery controller', () => {
  it('keeps the newest edit when asset loads finish out of order', async () => {
    const parent = new Group();
    const pending: Array<(object: Mesh) => void> = [];
    const controller = createSceneryController({
      parent,
      loadAsset: () =>
        new Promise<Mesh>((resolve) => {
          pending.push(resolve);
        }),
    });
    const first = controller.update(base);
    const second = controller.update({ ...base, items: [{ ...base.items[0]!, position: [4, 0, 0] }] });
    pending[1]!(new Mesh());
    await second;
    pending[0]!(new Mesh());
    await first;
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]!.children.find((item) => item.userData.sceneryId === 'tree')!.position.x).toBe(4);
    controller.dispose();
    expect(parent.children).toHaveLength(0);
    await expect(controller.update(base)).rejects.toThrow('disposed');
  });
  it('disposes generated terrain when replacing a scene', async () => {
    const parent = new Group();
    const controller = createSceneryController({ parent, loadAsset: async () => new Mesh() });
    await controller.update({
      ...base,
      terrain: [
        {
          id: 'path',
          kind: 'path',
          points: [
            [0, 0, 0],
            [2, 0, 0],
          ],
          width: 1,
        },
      ],
    });
    const terrain = parent.children[0]!.children.find((item) => item.userData.sceneryTerrain) as Mesh;
    const dispose = vi.spyOn(terrain.geometry, 'dispose');
    await controller.update(base);
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('does not dispose asset geometry even if its metadata resembles terrain', async () => {
    const parent = new Group();
    const asset = new Mesh();
    asset.userData.sceneryTerrain = true;
    const dispose = vi.spyOn(asset.geometry, 'dispose');
    const controller = createSceneryController({ parent, loadAsset: async () => asset });
    await controller.update(base);
    controller.dispose();
    expect(dispose).not.toHaveBeenCalled();
  });
});
