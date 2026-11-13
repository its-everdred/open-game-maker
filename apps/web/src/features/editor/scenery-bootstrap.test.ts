import { webcrypto } from 'node:crypto';
import { apply } from '@ogm/design-log/browser';
import { sceneryEntityId } from '@gm/sdk/vite';
import type { DesignDoc } from '@ogm/contracts/browser';
import type { Scenery } from '@ogm/contracts/scenery';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapScenery } from './scenery-bootstrap';

const scene: Scenery = {
  version: 1,
  items: [{ id: 'oak', assetId: 'tree', position: [4, 0, 2], rotation: [0, 1, 0], scale: [1, 1, 1], layer: 'mid' }],
  terrain: [],
  lighting: 'night',
  camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
};

describe('bootstrapScenery', () => {
  it('creates a replayable initial design with the same entity id as a build', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const doc: DesignDoc = { schemaVersion: 1, globals: {}, entities: {} };
    const intent = (await bootstrapScenery(doc, scene))!;
    expect(intent.doc.entities[sceneryEntityId('oak')]?.prefab).toBe('scenery:tree');
    expect(intent.doc.globals['scenery.lighting']).toBe('night');
    expect(apply(intent.doc, intent.inverse)).toEqual(doc);
    expect(await bootstrapScenery(intent.doc, scene)).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
