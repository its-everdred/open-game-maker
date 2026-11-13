import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';

import { DEFAULT_DESIGN } from '../src/game.js';
import { createScene } from '../src/scene.js';

describe('editor projection', () => {
  it('projects the center of the camera onto the ground plane', () => {
    const scene = createScene(DEFAULT_DESIGN);
    scene.camera.updateMatrixWorld();
    const point = scene.screenToWorld(0.5, 0.5);
    expect(point).not.toBeNull();
    expect(point![0]).toBeCloseTo(0);
    expect(point![1]).toBeCloseTo(0);
    expect(point![2]).toBeCloseTo(0);
    scene.dispose();
  });
  it('projects and picks a scenery entity through its model hierarchy', () => {
    const handle = createScene(DEFAULT_DESIGN);
    const root = new Group();
    root.userData.entityId = 'e_01K8ZTEMP00000000000000001';
    const model = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    root.add(model);
    root.position.set(8, 1, 0);
    handle.scene.add(root);
    handle.scene.updateMatrixWorld(true);
    handle.camera.updateMatrixWorld(true);
    const point = new Vector3().setFromMatrixPosition(root.matrixWorld).project(handle.camera);
    const screen = handle.worldToScreen(root.userData.entityId);
    expect(screen).not.toBeNull();
    expect(handle.pick((point.x + 1) / 2, (1 - point.y) / 2)).toContainEqual({
      id: root.userData.entityId,
      kind: 'entity',
    });
    handle.dispose();
    model.geometry.dispose();
    (model.material as MeshBasicMaterial).dispose();
  });
});
