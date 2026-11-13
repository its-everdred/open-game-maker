import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { parseScenery } from './data.js';
import { createScenery, frameScenery } from './render.js';

const scene = parseScenery(
  {
    version: 1,
    items: [
      { id: 'outside', assetId: 'tree', position: [4, 0, 0], rotation: [0, 1, 0], scale: [2, 1, 1], layer: 'back' },
      { id: 'inside', assetId: 'tree', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], layer: 'front' },
    ],
    terrain: [
      {
        id: 'stream',
        kind: 'water',
        points: [
          [4, 0, 1],
          [4, 0, 3],
        ],
        width: 1,
      },
    ],
    lighting: 'night',
    camera: { position: [0, 5, 5], target: [0, 0, 0], zoom: 1 },
  },
  [{ id: 'tree' }],
);

describe('createScenery', () => {
  it('applies the saved camera framing', () => {
    const camera = new PerspectiveCamera();
    frameScenery(camera, scene.camera);
    expect(camera.position.toArray()).toEqual([0, 5, 5]);
    expect(camera.zoom).toBe(1);
  });

  it('rejects an invalid protected area', async () => {
    await expect(
      createScenery({ scene, playArea: { minX: 2, maxX: 1, minZ: 0, maxZ: 1 }, loadAsset: async () => new Mesh() }),
    ).rejects.toThrow('play area');
  });

  it('starts asset loads together', async () => {
    const started: string[] = [];
    const resolvers: Array<(object: Mesh) => void> = [];
    const loading = createScenery({
      scene,
      loadAsset: (id) => {
        started.push(id);
        return new Promise<Mesh>((resolve) => {
          resolvers.push(resolve);
        });
      },
    });
    expect(started).toHaveLength(2);
    for (const resolve of resolvers) resolve(new Mesh());
    await loading;
  });

  it('renders transformed assets and terrain while protecting the play area', async () => {
    const group = await createScenery({
      scene,
      playArea: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
      loadAsset: async () => new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()),
    });
    const objects = group.children.filter((child) => child.userData.sceneryId);
    expect(objects.map((object) => object.userData.sceneryId)).toEqual(['outside', 'stream']);
    expect(objects[0]?.position.x).toBe(4);
    expect(objects[0]?.scale.x).toBe(2);
  });
});
