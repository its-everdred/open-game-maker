import { expect, it } from 'vitest';
import { intersectsViewport } from './parity-viewport';

it('includes partially visible content and excludes offscreen or missing boxes', () => {
  const viewport = { width: 390, height: 844 };
  expect(intersectsViewport({ x: 0, y: 840, width: 10, height: 20 }, viewport)).toBe(true);
  expect(intersectsViewport({ x: 0, y: 844, width: 10, height: 20 }, viewport)).toBe(false);
  expect(intersectsViewport(null, viewport)).toBe(false);
});
