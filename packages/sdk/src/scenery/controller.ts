import { Group, Mesh, type Object3D } from 'three';
import type { Scenery } from './data.js';
import { createScenery, isSceneryTerrain, type PlayArea } from './render.js';

/** Keep the last requested scene visible while assets for the next edit load. */
export function createSceneryController(options: {
  parent: Object3D;
  loadAsset(id: string): Promise<Object3D>;
  playArea?: PlayArea;
}) {
  let revision = 0;
  let current: Group | undefined;
  let disposed = false;
  return {
    async update(scene: Scenery): Promise<void> {
      if (disposed) throw new Error('scenery controller is disposed');
      const requested = ++revision;
      const next = await createScenery({
        scene,
        loadAsset: options.loadAsset,
        ...(options.playArea ? { playArea: options.playArea } : {}),
      });
      if (disposed || requested !== revision) {
        disposeTerrain(next);
        return;
      }
      if (current) {
        options.parent.remove(current);
        disposeTerrain(current);
      }
      current = next;
      options.parent.add(next);
    },
    dispose(): void {
      disposed = true;
      revision++;
      if (current) {
        options.parent.remove(current);
        disposeTerrain(current);
        current = undefined;
      }
    },
  };
}

function disposeTerrain(group: Group): void {
  for (const child of group.children) {
    if (!(child instanceof Mesh) || !isSceneryTerrain(child)) continue;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  }
}
