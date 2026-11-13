import type { HostApi } from '@ogm/contracts';
import type { AssetLoader } from '@gm/sdk/assets';
import { describe, expect, it, vi } from 'vitest';
import { defaultDesign, designSchema, game, getGameContext } from '../src/game.js';

describe('painted scenery in the 2D template', () => {
  it('preserves scenery across design application and uses the asset loader for placement', async () => {
    const id = 'e_01K8ZTEMP00000000000000001';
    const backdrop = {
      assetId: 'forest',
      landscape: { fit: 'cover', anchor: [0.5, 0.5] },
      portrait: { fit: 'cover', anchor: [0.5, 0.5] },
    };
    const next = designSchema.parse({
      ...defaultDesign,
      globals: {
        ...defaultDesign.globals,
        'scenery.backdrop': backdrop,
        'scenery.settings': {
          version: 1,
          lighting: 'night',
          terrain: [],
          camera: { position: [0, 0, 1], target: [0, 0, 0], zoom: 1 },
        },
      },
      entities: {
        ...defaultDesign.entities,
        [id]: {
          id,
          prefab: 'scenery:tree',
          level: 'main',
          origin: 'creator',
          props: { pose: { position: [200, 180, 0] } },
        },
      },
    });
    expect(next.globals['scenery.backdrop']).toEqual(backdrop);
    expect(next.entities[id]?.prefab).toBe('scenery:tree');
    const instance = await game.mount({} as HostApi, defaultDesign);
    const context = getGameContext();
    context.sceneryAssets = {
      resolve: vi.fn((asset: string) => {
        if (asset !== 'tree') throw new Error('missing');
        return {};
      }),
    } as unknown as AssetLoader;
    const update = vi.fn();
    context.updateScenery = update;
    instance.applyDesign(next, []);
    expect(update).toHaveBeenCalled();
    expect(instance.validatePlacement?.('scenery:tree', { position: [1, 2, 0] }).ok).toBe(true);
    expect(instance.validatePlacement?.('scenery:missing', { position: [1, 2, 0] }).ok).toBe(false);
    instance.dispose();
  });
});
