import { describe, expect, it } from 'vitest';

import { createFocusFollower } from './follow.js';

describe('createFocusFollower', () => {
  it('ignores small jitter and converges toward a distant target', () => {
    const follower = createFocusFollower(0.2, 2);
    expect(follower.step({ x: 0, y: 0 }, 16)).toEqual({ x: 0, y: 0 });
    expect(follower.step({ x: 1, y: 1 }, 16)).toEqual({ x: 0, y: 0 });

    const first = follower.step({ x: 100, y: 0 }, 100);
    expect(first.x).toBeGreaterThan(0);
    expect(first.x).toBeLessThan(100);
    let current = first;
    for (let index = 0; index < 100; index += 1) current = follower.step({ x: 100, y: 0 }, 100);
    expect(current.x).toBeCloseTo(100);
  });

  it('uses the normalized default smoothing value to ease at frame rate', () => {
    const follower = createFocusFollower(0.15, 0);
    follower.step({ x: 0, y: 0 }, 16);
    const next = follower.step({ x: 100, y: 0 }, 16);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(100);
  });
});
