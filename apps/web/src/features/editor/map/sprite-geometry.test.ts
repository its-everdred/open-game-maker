import { expect, it } from 'vitest';

import { spriteBounds, spritePixelAt } from './sprite-geometry';

it('keeps a scaled sprite grounded and maps a visible point back to its source pixel', () => {
  const center = { x: 300, y: 400 };
  const bounds = spriteBounds(center, 208, { width: 256, height: 256 }, 0.4);
  expect(bounds).toEqual({ x: 248.8, y: 316.8, width: 102.4, height: 102.4 });
  const source = spritePixelAt(center, bounds, 0.4);
  expect(source.x).toBeCloseTo(128);
  expect(source.y).toBeCloseTo(208);
  const outside = spritePixelAt({ x: bounds.x - 1, y: bounds.y }, bounds, 0.4);
  expect(outside.x).toBeLessThan(0);
});
