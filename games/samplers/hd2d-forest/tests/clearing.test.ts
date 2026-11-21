import { describe, expect, it } from 'vitest';

import { cellPoint, clearingPieces, depthBands, FIRE, HERO, HERO_DEPTH } from '../src/clearing.js';
import { FOCUS } from '../src/presets.js';
import { blurForDepth } from '../../../../packages/sdk/src/hd2d/focus/index.js';

const pieces = clearingPieces();
const row = (cell: readonly [number, number]) => cell[0] + cell[1] - HERO[0] - HERO[1];

describe('forest clearing layout', () => {
  it('keeps the hero cell and its neighbours open, with the campfire beside the hero as in the mock', () => {
    const near = pieces.filter(
      (piece) => !piece.ground && Math.hypot(piece.cell[0] - HERO[0], piece.cell[1] - HERO[1]) < 2.5,
    );
    expect(near.map((piece) => piece.key)).toEqual(['fireplace']);
    expect(cellPoint(FIRE).x).toBeGreaterThan(cellPoint(HERO).x);
  });

  it('rings the clearing with trees on every side of the hero', () => {
    const trees = pieces.filter((piece) => piece.key.startsWith('tree-a')).map((piece) => cellPoint(piece.cell));
    expect(trees.some(({ x }) => x < -300)).toBe(true);
    expect(trees.some(({ x }) => x > 300)).toBe(true);
    expect(trees.some(({ y }) => y < -200)).toBe(true);
    expect(trees.some(({ y }) => y > 200)).toBe(true);
    expect(trees.every(({ x, y }) => Math.hypot(x, y * 2) > 300)).toBe(true);
  });
});

describe('depth bands', () => {
  const bands = depthBands(pieces);
  const min = Math.min(...bands.map((band) => band.depth));
  const span = Math.max(...bands.map((band) => band.depth)) - min;
  const blur = (depth: number) => blurForDepth(FOCUS, (depth - min) / span, (HERO_DEPTH - min) / span);

  it('puts every piece in exactly one band, and every band has a real depth', () => {
    for (const band of bands) expect(Number.isFinite(band.depth)).toBe(true);
    expect(bands.flatMap((band) => band.pieces)).toHaveLength(pieces.length);
  });

  // Painter's order across bands: a later band must never hold a row an earlier band also holds.
  it('draws bands back to front around the hero', () => {
    const depths = bands.map((band) => band.depth);
    expect([...depths].sort((a, b) => a - b)).toEqual(depths);
    for (let i = 1; i < bands.length; i += 1)
      expect(Math.min(...bands[i]!.pieces.map((p) => row(p.cell)))).toBeGreaterThan(
        Math.max(...bands[i - 1]!.pieces.map((p) => row(p.cell))),
      );
    expect(depths.filter((depth) => depth < HERO_DEPTH)).toHaveLength(3);
  });

  it('keeps the ground around the hero crisp and blurs the far rows (Kevin: depth bands, hero crisp)', () => {
    const near = bands.filter((band) => band.pieces.some((piece) => Math.abs(row(piece.cell)) <= 1));
    expect(near.length).toBeGreaterThan(0);
    for (const band of near) expect(blur(band.depth)).toBe(0);
    expect(blur(bands[0]!.depth)).toBeGreaterThan(1);
    expect(blur(bands.at(-1)!.depth)).toBeGreaterThan(1);
  });

  it('draws ground before the props on the same row, so trees stand on the grass', () => {
    for (const band of bands)
      band.pieces.forEach((piece, index) => {
        const next = band.pieces[index + 1];
        if (next && row(next.cell) === row(piece.cell)) expect(!piece.ground && next.ground).toBe(false);
      });
  });
});
