import { describe, expect, it } from 'vitest';

import { findPath } from './grid.js';

describe('findPath', () => {
  it('finds a shortest four-way path around a wall and includes both endpoints', () => {
    const grid = new Uint8Array(100);
    for (let y = 0; y < 9; y += 1) grid[y * 10 + 5] = 1;

    const path = findPath(grid, 10, 10, [0, 0], [9, 0]);

    expect(path?.[0]).toEqual([0, 0]);
    expect(path?.at(-1)).toEqual([9, 0]);
    expect(path).toContainEqual([5, 9]);
    expect(path).toHaveLength(28);
  });

  it('returns null when the target is unreachable or outside the grid', () => {
    const grid = [
      [0, 1, 0],
      [1, 1, 1],
      [0, 1, 0],
    ];

    expect(findPath(grid, 3, 3, [0, 0], [2, 2])).toBeNull();
    expect(findPath(grid, 3, 3, [-1, 0], [2, 2])).toBeNull();
  });

  it('uses diagonals without cutting blocked corners by default', () => {
    const open = new Uint8Array(100);
    expect(findPath(open, 10, 10, [0, 0], [9, 9], { diagonal: true })).toHaveLength(10);

    const corner = [
      [0, 1],
      [1, 0],
    ];
    expect(findPath(corner, 2, 2, [0, 0], [1, 1], { diagonal: true })).toBeNull();
    expect(findPath(corner, 2, 2, [0, 0], [1, 1], { diagonal: true, cutCorners: true })).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('bounds grid accesses when searching a seeded 200 by 200 wall grid', () => {
    const grid = new Uint8Array(200 * 200);
    let state = 7;
    for (let index = 0; index < grid.length; index += 1) {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      grid[index] = state / 4_294_967_296 < 0.3 ? 1 : 0;
    }
    grid[0] = 0;
    grid[grid.length - 1] = 0;

    let accesses = 0;
    const countedGrid = new Proxy(grid, {
      get(target, property) {
        if (typeof property === 'string' && /^\d+$/.test(property)) accesses += 1;
        return Reflect.get(target, property, target);
      },
    });

    const path = findPath(countedGrid, 200, 200, [0, 0], [199, 199]);
    expect(path).toBeNull();
    // Baseline: 109,081 reads. Guard against early exit and extra search work.
    expect(accesses).toBeGreaterThan(50_000);
    expect(accesses).toBeLessThan(160_000);
  });
});
