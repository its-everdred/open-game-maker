import { describe, expect, it } from 'vitest';
import { sceneryFromDesign, sceneryToDesign } from './design.js';
import { ScenerySchema } from './data.js';

const scene = ScenerySchema.parse({
  version: 1,
  items: [
    {
      id: 'tree',
      assetId: 'tree-asset',
      position: [1, 0, 2],
      rotation: [0.2, 0.5, 0.3],
      scale: [1, 2, 1],
      layer: 'back',
    },
  ],
  terrain: [],
  lighting: 'night',
  camera: { position: [0, 5, 5], target: [0, 0, 0], zoom: 1 },
});
const id = 'e_01K8ZTEMP00000000000000001';

describe('scenery design adapter', () => {
  it('round trips a scene and keeps unrelated game data', () => {
    const doc = { schemaVersion: 1, globals: { speed: 2 }, entities: {} };
    const mapped = sceneryToDesign(scene, doc, () => id);
    expect(mapped.globals.speed).toBe(2);
    expect(sceneryFromDesign(mapped, [{ id: 'tree-asset' }])).toEqual(scene);
    expect(doc.entities).toEqual({});
  });
  it('reads a creator transform and rejects an unlocked placement', () => {
    const doc = sceneryToDesign(scene, { schemaVersion: 1, globals: {}, entities: {} }, () => id);
    doc.entities[id]!.props.pose = { position: [4, 0, 3], rotationY: 90 };
    expect(sceneryFromDesign(doc, [{ id: 'tree-asset' }]).items[0]).toMatchObject({
      position: [4, 0, 3],
      rotation: [0.2, Math.PI / 2, 0.3],
    });
    doc.globals['scenery.lighting'] = 'cave';
    expect(sceneryFromDesign(doc, [{ id: 'tree-asset' }]).lighting).toBe('cave');
    expect(() => sceneryFromDesign(doc, [])).toThrow('not in the lock');
  });
  it('maps placements created by the generic editor and respects deletion', () => {
    const doc = sceneryToDesign(scene, { schemaVersion: 1, globals: {}, entities: {} }, () => id);
    delete doc.entities[id];
    const newId = 'e_01K8ZTEMP00000000000000002';
    doc.entities[newId] = {
      id: newId,
      prefab: 'scenery:tree-asset',
      level: 'main',
      origin: 'creator',
      props: { pose: { position: [2, 0, 3] } },
    };
    expect(sceneryFromDesign(doc, [{ id: 'tree-asset' }]).items).toEqual([
      { id: newId, assetId: 'tree-asset', position: [2, 0, 3], rotation: [0, 0, 0], scale: [1, 1, 1], layer: 'mid' },
    ]);
  });
});
