import { describe, expect, it } from 'vitest';

import { path, scatter } from '../src/placement.js';

const grid = (width: number, height: number) =>
  Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) }));

describe('path', () => {
  it('connects entries through walkable cells without crossing an obstacle', () => {
    const route = path(
      { x: 0, y: 1 },
      { x: 3, y: 1 },
      grid(4, 3).filter(({ x, y }) => x !== 1 || y !== 1),
    );
    expect(route[0]).toEqual({ x: 0, y: 1 });
    expect(route.at(-1)).toEqual({ x: 3, y: 1 });
    expect(route).toHaveLength(6);
    expect(route).not.toContainEqual({ x: 1, y: 1 });
    for (let i = 1; i < route.length; i++) {
      expect(Math.abs(route[i]!.x - route[i - 1]!.x) + Math.abs(route[i]!.y - route[i - 1]!.y)).toBe(1);
    }
  });

  it('rejects disconnected and non-walkable endpoints', () => {
    expect(() =>
      path({ x: 0, y: 0 }, { x: 2, y: 0 }, [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toThrow('disconnected');
    expect(() => path({ x: 0, y: 0 }, { x: 1, y: 0 }, [{ x: 0, y: 0 }])).toThrow('walkable');
  });
});

describe('scatter', () => {
  it('is seeded and never blocks a path or entry', () => {
    const region = grid(10, 10);
    const avoid = path({ x: 0, y: 5 }, { x: 9, y: 5 }, region);
    const rules = { seed: 42, avoid, boundaries: [{ x: 0, y: 0 }], boundaryDensity: 0.4 };
    const first = scatter(region, ['tree', 'shrub'], 0.5, rules);
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(scatter(region, ['tree', 'shrub'], 0.5, rules));
    expect(first).not.toEqual(scatter(region, ['tree', 'shrub'], 0.5, { ...rules, seed: 43 }));
    expect(first.every(({ cell }) => !avoid.some((reserved) => reserved.x === cell.x && reserved.y === cell.y))).toBe(
      true,
    );
  });

  it('densifies boundary cells and deduplicates a region', () => {
    const cell = { x: 1, y: 0 };
    expect(
      scatter([cell, cell], ['shrub'], 0, { seed: 1, avoid: [], boundaries: [{ x: 0, y: 0 }], boundaryDensity: 1 }),
    ).toEqual([{ cell, item: 'shrub' }]);
    expect(scatter([cell], ['shrub'], 0, { seed: 1, avoid: [], boundaries: [], boundaryDensity: 1 })).toEqual([]);
  });
});
