import type { AssetLoader } from '@gm/sdk/assets';
import { createSceneryController, sceneryFromDesign } from '@gm/sdk/scenery';
import { DesignDocSchema } from '@ogm/contracts/browser';
import type { Scene } from 'three';
import type { LevelDesign } from './game.js';

/** Connect the reusable scenery renderer to a game's editable design. */
export function attachScenery(scene: Scene, loader: AssetLoader, size: number) {
  const half = size / 2;
  const controller = createSceneryController({
    parent: scene,
    loadAsset: (id) => loader.object(id),
    playArea: { minX: -half, maxX: half, minZ: -half, maxZ: half },
  });
  let generation = 0;
  return {
    async update(design: LevelDesign): Promise<void> {
      const request = ++generation;
      if (!('scenery.settings' in design.globals)) return;
      const ids = Object.values(design.entities)
        .filter((entity) => entity.prefab.startsWith('scenery:'))
        .map((entity) => entity.prefab.slice('scenery:'.length));
      for (const id of ids) loader.resolve(id);
      await controller.update(
        sceneryFromDesign(
          DesignDocSchema.parse(design),
          ids.map((id) => ({ id })),
        ),
      );
      if (request !== generation) return;
      const entityIds = new Map(
        Object.values(design.entities)
          .filter((entity) => entity.prefab !== 'spawn')
          .map((entity) => [
            typeof entity.props.sceneryItemId === 'string' ? entity.props.sceneryItemId : entity.id,
            entity.id,
          ]),
      );
      const root = scene.children.find((child) => child.name === 'scenery');
      for (const child of root?.children ?? []) {
        const id = entityIds.get(child.userData.sceneryId);
        if (id) child.userData.entityId = id;
      }
    },
    dispose() {
      generation++;
      controller.dispose();
    },
  };
}
