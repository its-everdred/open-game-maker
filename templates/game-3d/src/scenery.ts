import type { AssetLoader } from '@gm/sdk/assets';
import { createPaintedBackground, createSceneryController, sceneryFromDesign } from '@gm/sdk/scenery';
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
  let painted: ReturnType<typeof createPaintedBackground> | undefined;
  let itemIds = new Map<string, string>();
  let paintedActive = false;
  let cameraOrigin: [number, number] | undefined;
  let viewportSize: [number, number] | undefined;
  let generation = 0;
  return {
    async update(design: LevelDesign): Promise<void> {
      const request = ++generation;
      if (!('scenery.settings' in design.globals)) return;
      const ids = Object.values(design.entities)
        .filter((entity) => entity.prefab.startsWith('scenery:'))
        .map((entity) => entity.prefab.slice('scenery:'.length));
      const settings = design.globals['scenery.settings'] as { backdrop?: unknown } | undefined;
      const globals = design.globals as Record<string, unknown>;
      const backdrop = (globals['scenery.backdrop'] ?? settings?.backdrop) as { assetId?: unknown } | undefined;
      if (typeof backdrop?.assetId === 'string') ids.push(backdrop.assetId);
      for (const id of ids) loader.resolve(id);
      const data = sceneryFromDesign(
        DesignDocSchema.parse(design),
        ids.map((id) => ({ id })),
      );
      const nextIds = new Map(
        Object.values(design.entities)
          .filter((entity) => entity.prefab.startsWith('scenery:'))
          .map((entity) => {
            const props = entity.props as Record<string, unknown>;
            return [typeof props.sceneryItemId === 'string' ? props.sceneryItemId : entity.id, entity.id];
          }),
      );
      if (data.backdrop) {
        const isImage = (id: string) => /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(loader.resolve(id).url);
        const sprites = data.items.filter((item) => isImage(item.assetId));
        const models = data.items.filter((item) => !isImage(item.assetId));
        await controller.update({ ...data, items: models });
        if (request !== generation) return;
        painted ??= createPaintedBackground(scene, (id) => loader.resolve(id).url);
        await painted.update({ ...data, items: sprites });
        if (request !== generation) return;
        if (viewportSize) painted.resize(...viewportSize);
        itemIds = nextIds;
        paintedActive = true;
        const root = scene.children.find((child) => child.name === 'scenery');
        for (const child of root?.children ?? []) {
          const id = nextIds.get(child.userData.sceneryId);
          if (id) child.userData.entityId = id;
        }
        return;
      }
      paintedActive = false;
      cameraOrigin = undefined;
      painted?.clear();
      await controller.update(data);
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
    isPainted: () => paintedActive,
    resize: (width: number, height: number) => {
      viewportSize = [width, height];
      painted?.resize(width, height);
    },
    draw: (x: number, y: number) => {
      if (!paintedActive) return;
      cameraOrigin ??= [x, y];
      painted?.draw(x - cameraOrigin[0], y - cameraOrigin[1]);
    },
    pick: (x: number, y: number) =>
      (painted?.pick(x, y) ?? []).flatMap((id) => {
        const entity = itemIds.get(id);
        return entity ? [{ kind: 'entity' as const, id: entity }] : [];
      }),
    project: (x: number, y: number) => painted?.project(x, y) ?? null,
    screen: (entity: string) => {
      const item = [...itemIds].find(([, id]) => id === entity)?.[0];
      const position = item && painted?.position(item);
      if (!position) return null;
      return painted!.screen(position);
    },
    dispose() {
      generation++;
      controller.dispose();
      painted?.dispose();
    },
  };
}
