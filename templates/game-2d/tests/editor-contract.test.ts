import type { HostApi } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { defaultDesign, designSchema, game, getGameContext } from '../src/game.js';

describe('2D editor contract', () => {
  it('places and moves an editor platform, and projects against the current camera', async () => {
    const doc = structuredClone(defaultDesign) as unknown as { entities: Record<string, unknown> };
    doc.entities.editor_platform = {
      id: 'editor_platform',
      prefab: 'platform',
      level: 'main',
      origin: 'creator',
      props: { pose: { position: [500, 300, 0], rotation: [0, 0, 0] } },
    };
    const design = designSchema.parse(doc);
    const instance = await game.mount({} as HostApi, design);
    getGameContext().view = { screenToWorld: () => [500, 300], worldToScreen: () => ({ x: 50, y: 30 }) };
    expect(instance.pick?.(0.5, 0.3)).toContainEqual({ id: 'editor_platform', kind: 'entity' });
    expect(instance.screenToWorld?.(0.5, 0.3)).toEqual([500, 300, 0]);
    const moved = structuredClone(design);
    moved.entities.editor_platform!.props.pose!.position = [600, 250, 0];
    instance.applyDesign(moved, [
      {
        op: 'replace',
        path: ['entities', 'editor_platform', 'props', 'pose'],
        value: moved.entities.editor_platform!.props.pose,
      },
    ]);
    expect(getGameContext().state.platforms.find((item) => item.id === 'editor_platform')).toMatchObject({
      x: 600,
      y: 250,
    });
    instance.dispose();
  });
});
