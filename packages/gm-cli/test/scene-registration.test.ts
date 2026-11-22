import { describe, expect, it } from 'vitest';
import { fitGroundPlane, fitImageToGround, projectGround } from '../src/scene/registration.js';

describe('ground registration', () => {
  it('maps a projective quadrilateral and interior ground points', () => {
    const anchors = [
      { ground: { x: 0, y: 0 }, image: { x: 10, y: 20 } },
      { ground: { x: 8, y: 0 }, image: { x: 26 / 1.16, y: 12 / 1.16 } },
      { ground: { x: 8, y: 5 }, image: { x: 31 / 1.31, y: 27 / 1.31 } },
      { ground: { x: 0, y: 5 }, image: { x: 15 / 1.15, y: 35 / 1.15 } },
    ];
    const fitted = fitGroundPlane(anchors);
    const interior = projectGround(fitted, { x: 3, y: 2 });
    expect(interior.x).toBeCloseTo(18 / 1.12, 8);
    expect(interior.y).toBeCloseTo(23 / 1.12, 8);
    const inverse = fitImageToGround(anchors);
    const recovered = projectGround(inverse, { x: 18 / 1.12, y: 23 / 1.12 });
    expect(recovered.x).toBeCloseTo(3, 8);
    expect(recovered.y).toBeCloseTo(2, 8);
  });

  it('fits an inverse whose bottom-right homogeneous coefficient is zero', () => {
    const anchors = [
      { ground: { x: 0, y: 0 }, image: { x: 0, y: 1 } },
      { ground: { x: 4, y: 0 }, image: { x: 4, y: 1 } },
      { ground: { x: 4, y: 3 }, image: { x: 1, y: 0.25 } },
      { ground: { x: 0, y: 3 }, image: { x: 0, y: 0.25 } },
    ];
    const inverse = fitImageToGround(anchors);
    const point = projectGround(inverse, { x: 1, y: 0.5 });
    expect(point.x).toBeCloseTo(2);
    expect(point.y).toBeCloseTo(1);
  });

  it('rejects collinear and non-finite anchors instead of guessing a transform', () => {
    const anchors = [0, 1, 2, 3].map((x) => ({ ground: { x, y: 0 }, image: { x, y: x } }));
    expect(() => fitGroundPlane(anchors)).toThrow('degenerate');
    anchors[0]!.ground.x = NaN;
    expect(() => fitGroundPlane(anchors)).toThrow('finite');
  });

  it('rejects numeric overflow rather than producing non-finite coordinates', () => {
    expect(() => projectGround([1e308, 0, 0, 0, 1, 0, 0, 0, 1], { x: 1e308, y: 1 })).toThrow('numeric range');
  });

  it('projects the same point when homogeneous coefficients are rescaled', () => {
    const point = projectGround([1e-20, 0, 0, 0, 1e-20, 0, 0, 0, 1e-20], { x: 2, y: 3 });
    expect(point.x).toBeCloseTo(2);
    expect(point.y).toBeCloseTo(3);
  });

  it('rejects projections on the horizon', () => {
    expect(() => projectGround([1, 0, 0, 0, 1, 0, -1, 0, 1], { x: 1, y: 2 })).toThrow('horizon');
  });
});
