import { describe, expect, it } from 'vitest';

import type { GameManifest, Pose } from '@ogm/contracts/browser';

import { movePose, normalizeFramePoint, placementPose, stepPose } from './canvas';

const manifest = {
  dimension: '2d',
  presentation: { minLogical: { w: 100, h: 60 } },
} as unknown as GameManifest;

describe('editor canvas geometry', () => {
  it('normalizes frame coordinates and snaps a placement pose to the device grid', () => {
    expect(normalizeFramePoint(34, 58, { left: 10, top: 20, width: 100, height: 80 })).toEqual({ x: 0.24, y: 0.475 });
    expect(placementPose({ x: 0.024, y: 0.04 }, manifest, { version: 1, enabled: true, grid: 1 })).toEqual({
      position: [2, 2, 0],
    });
  });

  it('maps a drag to a bounded gizmo pose without accumulating pointer-event error', () => {
    const start: Pose = { position: [95, 20, 0] };

    expect(
      movePose(start, 'translate', { x: 0.4, y: -0.5 }, manifest, { version: 1, enabled: false, grid: 1 }),
    ).toEqual({
      position: [100, 0, 0],
    });
  });

  it('gives a stepper the same bounded operation and reports an edge no-op', () => {
    const atEdge: Pose = { position: [100, 20, 0] };

    expect(stepPose(atEdge, 'translate', 1, manifest, { version: 1, enabled: true, grid: 1 })).toBeUndefined();
    expect(stepPose(atEdge, 'translate', -1, manifest, { version: 1, enabled: true, grid: 1 })).toEqual({
      position: [99, 20, 0],
    });
  });

  it('steps projected 3D world positions without clamping them to pixel bounds', () => {
    const projected = { ...manifest, dimension: '3d', capabilities: ['editor.project'] } as GameManifest;
    expect(
      stepPose({ position: [-3, 0, 0] }, 'translate', 1, projected, { version: 1, enabled: true, grid: 1 }),
    ).toEqual({
      position: [-2, 0, 0],
    });
  });
});
