import { describe, expect, it } from 'vitest';
import {
  fixedAspectMinimumFill,
  matchesPlayAreaAspect,
  measurePlayArea,
  type PlayAreaGeometry,
} from '../src/play-area.js';

const geometry: PlayAreaGeometry = {
  viewport: { width: 1180, height: 820 },
  board: { left: 180, top: 90, width: 820, height: 640 },
  safe: { top: 10, bottom: 10, left: 0, right: 0 },
  controls: { top: 80, bottom: 80 },
};

describe('play-area measurement', () => {
  it('measures against safe areas and control bands', () => {
    expect(measurePlayArea(geometry)).toEqual({ fill: 1, offset: 0, ok: true });
  });
  it('fails a small or off-centre board and honors configured limits', () => {
    const small = { ...geometry, board: { ...geometry.board, left: 300, height: 390 } };
    expect(measurePlayArea(small)).toMatchObject({ fill: 390 / 640, ok: false });
    expect(measurePlayArea(small, { minFill: 0.6, maxOffset: 0.11 }).ok).toBe(true);
  });
  it('rejects invalid dimensions and non-finite thresholds', () => {
    expect(() => measurePlayArea({ ...geometry, controls: { top: 820, bottom: 0 } })).toThrow();
    expect(() => measurePlayArea(geometry, { minFill: NaN, maxOffset: 0.05 })).toThrow();
  });
  it('does not count a board that extends outside the usable area', () => {
    expect(measurePlayArea({ ...geometry, board: { ...geometry.board, top: -550, height: 1280 } }).ok).toBe(false);
    expect(measurePlayArea({ ...geometry, board: { ...geometry.board, top: -1000, height: 1100 } }).ok).toBe(false);
  });
  it('rejects a full-height off-centre or horizontally clipped board', () => {
    expect(measurePlayArea({ ...geometry, board: { ...geometry.board, left: 300 } }).ok).toBe(false);
    expect(measurePlayArea({ ...geometry, board: { ...geometry.board, left: -590, width: 2360 } }).ok).toBe(false);
  });
  it('requires fixed-aspect boards to fill the largest space available at each viewport', () => {
    for (const [width, height] of [
      [390, 844],
      [844, 390],
      [820, 1180],
      [1180, 820],
    ]) {
      const available = {
        ...geometry,
        viewport: { width: width!, height: height! },
        safe: { top: 0, bottom: 0, left: 0, right: 0 },
        controls: { top: 0, bottom: 0 },
      };
      const boardHeight = Math.min(height!, width! * 0.75);
      const boardWidth = (boardHeight * 4) / 3;
      const board = {
        ...available,
        board: {
          left: (width! - boardWidth) / 2,
          top: (height! - boardHeight) / 2,
          width: boardWidth,
          height: boardHeight,
        },
      };
      const limits = { minFill: fixedAspectMinimumFill(board, 4 / 3), maxOffset: 0.05 };
      expect(measurePlayArea(board, limits).ok).toBe(true);
      expect(matchesPlayAreaAspect(board.board, 4 / 3)).toBe(true);
      expect(matchesPlayAreaAspect({ ...board.board, width: 20 }, 4 / 3)).toBe(false);
      expect(measurePlayArea({ ...board, board: { ...board.board, height: boardHeight * 0.8 } }, limits).ok).toBe(
        false,
      );
    }
  });
});
