import { describe, expect, it } from 'vitest';
import { parseScenery, ScenerySchema } from './data.js';

const scene = {
  version: 1,
  items: [{ id: 'tree-1', assetId: 'tree', position: [1, 0, 2], rotation: [0, 1, 0], scale: [1, 1, 1], layer: 'back' }],
  terrain: [
    {
      id: 'stream',
      kind: 'water',
      points: [
        [0, 0, 0],
        [1, 0, 1],
      ],
      width: 2,
    },
  ],
  lighting: 'warm-forest',
  camera: { position: [0, 5, 5], target: [0, 0, 0], zoom: 1 },
};

describe('scenery data', () => {
  it('round trips scene data with locked assets', () => {
    expect(parseScenery(JSON.parse(JSON.stringify(scene)), [{ id: 'tree' }])).toEqual(scene);
  });
  it('rejects missing assets and ambiguous item ids', () => {
    expect(() => parseScenery(scene, [])).toThrow('Scenery asset is not in the lock: tree');
    expect(ScenerySchema.safeParse({ ...scene, items: [scene.items[0], scene.items[0]] }).success).toBe(false);
  });
  it('validates a locked backdrop and preserves item parallax', () => {
    const painted = {
      ...scene,
      viewport: { width: 640, height: 480 },
      backdrop: {
        assetId: 'forest',
        landscape: { fit: 'cover', anchor: [0.5, 1] },
        portrait: { fit: 'contain', anchor: [0, 0.5] },
      },
      items: [{ ...scene.items[0], parallax: 0.5 }],
    };
    expect(parseScenery(painted, [{ id: 'tree' }, { id: 'forest' }])).toEqual(painted);
    expect(() => parseScenery(painted, [{ id: 'tree' }])).toThrow('Scenery asset is not in the lock: forest');
    expect(ScenerySchema.safeParse({ ...painted, viewport: { width: 0, height: 480 } }).success).toBe(false);
    expect(ScenerySchema.safeParse({ ...painted, dimension: '4d' }).success).toBe(false);
  });
  it('rejects unsupported versions and invalid transforms', () => {
    expect(ScenerySchema.safeParse({ ...scene, version: 2 }).success).toBe(false);
    expect(ScenerySchema.safeParse({ ...scene, items: [{ ...scene.items[0], scale: [0, 1, 1] }] }).success).toBe(false);
  });
});
