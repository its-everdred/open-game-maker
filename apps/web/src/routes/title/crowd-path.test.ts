import { describe, expect, it } from 'vitest';
import { blocked, route } from '../../../title-town/crowd-path.js';

describe('crowd paths', () => {
  it('rejects invalid coordinates instead of producing invalid positions', () => {
    expect(route([NaN, 0], [1, 2], [])).toBeNull();
  });

  it('routes around a building instead of crossing its footprint', () => {
    const obstacles = [{ x: 0, z: 0, yaw: 0, halfX: 2, halfZ: 3 }];
    const path = route([-6, 0], [6, 0], obstacles);
    if (!path) throw new Error('expected a path');
    expect(path[0]).toEqual([-6, 0]);
    expect(path.at(-1)).toEqual([6, 0]);
    for (let i = 1; i < path.length; i++)
      for (let t = 0; t <= 1; t += 0.05) {
        expect(
          blocked(
            path[i - 1].map((v, j) => v + (path[i][j] - v) * t),
            obstacles,
          ),
        ).toBe(false);
      }
    expect(path.some((p) => Math.abs(p[1]) > 3)).toBe(true);
  });

  it('uses updated obstacle positions on the next route', () => {
    const obstacles = [{ x: 0, z: 8, yaw: 0, halfX: 2, halfZ: 2 }];
    expect(route([-6, 0], [6, 0], obstacles)).toHaveLength(2);
    obstacles[0].z = 0;
    const path = route([-6, 0], [6, 0], obstacles);
    if (!path) throw new Error('expected a path');
    expect(path.some((p) => Math.abs(p[1]) > 2)).toBe(true);
  });

  it('avoids a small corner between grid samples', () => {
    const obstacles = [{ x: 0.15, z: 0.15, yaw: 0, halfX: 0.05, halfZ: 0.05 }];
    const path = route([0, 0], [1.5, 1.5], obstacles);
    if (!path) throw new Error('expected a path');
    for (let i = 1; i < path.length; i++)
      for (let t = 0; t <= 1; t += 0.01) {
        expect(
          blocked(
            path[i - 1].map((v, j) => v + (path[i][j] - v) * t),
            obstacles,
          ),
        ).toBe(false);
      }
  });

  it('stays in the reachable area when a destination is enclosed', () => {
    const obstacles = [
      { x: 0, z: -4, yaw: 0, halfX: 4, halfZ: 1 },
      { x: 0, z: 4, yaw: 0, halfX: 4, halfZ: 1 },
      { x: -4, z: 0, yaw: 0, halfX: 1, halfZ: 4 },
      { x: 4, z: 0, yaw: 0, halfX: 1, halfZ: 4 },
    ];
    const path = route([-9, 0], [0, 0], obstacles);
    if (!path) throw new Error('expected a reachable fallback');
    expect(path.at(-1)![0]).toBeLessThan(-5);
    expect(path.every((p) => !blocked(p, obstacles))).toBe(true);
  });

  it('moves a destination out of a rotated footprint', () => {
    const obstacles = [{ x: 0, z: 0, yaw: Math.PI / 4, halfX: 4, halfZ: 1 }];
    const path = route([-9, 0], [0, 0], obstacles);
    if (!path) throw new Error('expected a path');
    expect(blocked(path.at(-1)!, obstacles)).toBe(false);
  });
});
