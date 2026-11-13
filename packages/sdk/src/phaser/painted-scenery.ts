import type Phaser from 'phaser';
import { backdropRect } from '../scenery/painted.js';
import type { Scenery } from '../scenery/data.js';

/** Mount image scenery in a Phaser scene. Resolve only asset IDs approved by the game asset loader. */
export function createPaintedScenery(scene: Phaser.Scene, resolveUrl: (id: string) => string) {
  const objects: Phaser.GameObjects.Image[] = [];
  const textures = new Map<string, Promise<string>>();
  const prefix = `painted-${crypto.randomUUID()}-`;
  let revision = 0;
  let disposed = false;
  let backdrop: { object: Phaser.GameObjects.Image; data: NonNullable<Scenery['backdrop']> } | undefined;

  function load(id: string): Promise<string> {
    let pending = textures.get(id);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          if (disposed) return reject(new Error('painted scenery disposed'));
          const key = prefix + id;
          scene.textures.addImage(key, image);
          resolve(key);
        };
        image.onerror = () => reject(new Error(`scenery image unavailable: ${id}`));
        image.src = resolveUrl(id);
      });
      textures.set(id, pending);
      void pending.catch(() => {
        if (textures.get(id) === pending) textures.delete(id);
      });
    }
    return pending;
  }
  function resize() {
    if (!backdrop) return;
    const camera = scene.cameras.main;
    const source = backdrop.object.texture.getSourceImage();
    const parent = scene.scale?.parentSize;
    const rect = backdropRect(
      backdrop.data,
      { width: source.width, height: source.height },
      {
        width: camera.width,
        height: camera.height,
        ...(parent?.width && parent.height ? { aspect: parent.width / parent.height } : {}),
      },
    );
    backdrop.object.setPosition(rect.x, rect.y).setDisplaySize(rect.width, rect.height);
  }
  return {
    async update(data: Scenery): Promise<void> {
      const request = ++revision;
      const ids = [
        ...new Set([...data.items.map((item) => item.assetId), ...(data.backdrop ? [data.backdrop.assetId] : [])]),
      ];
      const keys = new Map(await Promise.all(ids.map(async (id) => [id, await load(id)] as const)));
      if (disposed || request !== revision) return;
      for (const object of objects.splice(0)) object.destroy();
      backdrop = undefined;
      if (data.backdrop) {
        const object = scene.add
          .image(0, 0, keys.get(data.backdrop.assetId)!)
          .setOrigin(0)
          .setScrollFactor(0)
          .setDepth(-100000);
        objects.push(object);
        backdrop = { object, data: data.backdrop };
        resize();
      }
      const layers = { back: 0, mid: 1, front: 2 };
      const items = [...data.items].sort((a, b) => layers[a.layer] - layers[b.layer] || a.position[2] - b.position[2]);
      for (const [index, item] of items.entries()) {
        const object = scene.add
          .image(item.position[0], item.position[1], keys.get(item.assetId)!)
          .setScale(item.scale[0], item.scale[1])
          .setRotation(item.rotation[2])
          .setScrollFactor(item.parallax ?? 1)
          .setDepth(-99999 + index);
        object.setData('sceneryId', item.id);
        objects.push(object);
      }
    },
    resize,
    pick(worldX: number, worldY: number): string[] {
      const camera = scene.cameras.main;
      return [...objects]
        .sort((a, b) => b.depth - a.depth)
        .flatMap((object) => {
          const id = object.getData('sceneryId') as unknown;
          if (typeof id !== 'string') return [];
          const x = worldX + camera.scrollX * (object.scrollFactorX - 1);
          const y = worldY + camera.scrollY * (object.scrollFactorY - 1);
          return object.getBounds().contains(x, y) ? [id] : [];
        });
    },
    dispose(): void {
      disposed = true;
      revision++;
      for (const object of objects.splice(0)) object.destroy();
      for (const pending of textures.values())
        void pending.then((key) => scene.textures.remove(key)).catch(() => undefined);
      textures.clear();
    },
  };
}
