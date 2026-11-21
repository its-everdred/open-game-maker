import { describe, expect, it } from 'vitest';
import { scatter } from '../src/scene/scatter.js';

describe('scene dressing scatter', () => {
  it('is repeatable, respects excluded cells, and maintains minimum spacing', () => {
    const field = { width: 4, height: 3, weights: [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1] };
    const options = { count: 12, radius: 0.3, seed: 42, attemptsPerPoint: 200 };
    const points = scatter(field, options);
    expect(points).toHaveLength(12);
    expect(scatter(field, options)).toEqual(points);
    expect(scatter(field, { ...options, seed: 43 })).not.toEqual(points);
    for (const [i, point] of points.entries()) {
      expect(field.weights[Math.floor(point.y) * field.width + Math.floor(point.x)]).toBe(1);
      for (const other of points.slice(i + 1))
        expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('samples a higher-density region more often', () => {
    const points = scatter({ width: 2, height: 1, weights: [1, 0.1] }, { count: 1000, radius: 0, seed: 19 });
    expect(points).toHaveLength(1000);
    const low = points.filter((point) => point.x >= 1).length;
    expect(low).toBeGreaterThan(50);
    expect(low).toBeLessThan(140);
  });

  it('returns fewer points when space is exhausted and rejects malformed fields', () => {
    expect(scatter({ width: 1, height: 1, weights: [1] }, { count: 10, radius: 2, seed: 1 })).toHaveLength(1);
    expect(scatter({ width: 1, height: 1, weights: [0] }, { count: 10, radius: 1, seed: 1 })).toEqual([]);
    expect(() => scatter({ width: 1, height: 1, weights: [NaN] }, { count: 1, radius: 1, seed: 1 })).toThrow('invalid');
  });
});
