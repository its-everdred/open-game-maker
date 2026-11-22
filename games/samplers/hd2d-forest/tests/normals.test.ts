import { describe, expect, it } from 'vitest';

import { normalsFromAlpha } from '../src/normals.js';

/** A 9x9 opaque square in a 15x15 image, with a half-transparent shadow strip under it. */
function sprite(): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(15 * 15);
  for (let y = 3; y < 12; y += 1) for (let x = 3; x < 12; x += 1) alpha[y * 15 + x] = 255;
  for (let x = 3; x < 12; x += 1) alpha[13 * 15 + x] = 110;
  return alpha;
}

const normalAt = (normals: Uint8ClampedArray, x: number, y: number) =>
  [0, 1, 2].map((channel) => normals[(y * 15 + x) * 4 + channel]! / 127.5 - 1);

describe('normals from alpha', () => {
  const normals = normalsFromAlpha(sprite(), 15, 15, 2);

  // A light to the sprite's right must brighten its right edge, so that edge has to face right (and left faces left).
  it('tilts silhouette edges outward so side lights shade the sprite', () => {
    expect(normalAt(normals, 3, 7)[0]).toBeLessThan(-0.2);
    expect(normalAt(normals, 11, 7)[0]).toBeGreaterThan(0.2);
    expect(normalAt(normals, 7, 3)[1]).toBeGreaterThan(0.2);
    expect(normalAt(normals, 7, 11)[1]).toBeLessThan(-0.2);
  });

  it('faces the camera in the middle of the sprite', () => {
    const [x, y, z] = normalAt(normals, 7, 7);
    expect(Math.abs(x!)).toBeLessThan(0.05);
    expect(Math.abs(y!)).toBeLessThan(0.05);
    expect(z).toBeGreaterThan(0.95);
  });

  // The pack bakes a translucent drop shadow into the sheet; it must not catch light like a raised surface.
  it('leaves the baked shadow flat', () => {
    expect(normalAt(normals, 7, 13)).toEqual(normalAt(normals, 0, 0));
    expect(normalAt(normals, 0, 0)[2]).toBeGreaterThan(0.99);
  });
});
