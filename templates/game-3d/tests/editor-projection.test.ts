import { describe, expect, it } from 'vitest';

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
});
