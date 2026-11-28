import { describe, expect, it } from 'vitest';
import { glassMetrics } from './metrics.js';

describe('glass parity metrics', () => {
  const black = new Uint8Array(8 * 8 * 3);
  const white = new Uint8Array(8 * 8 * 3).fill(255);
  it('accepts identical images and detects changed colour and structure', () => {
    expect(glassMetrics(black, black, 8, 8)).toEqual({ ssim: 1, deltaEOver3Percent: 0 });
    const result = glassMetrics(black, white, 8, 8);
    expect(result.ssim).toBeLessThan(0.97);
    expect(result.deltaEOver3Percent).toBe(100);
  });
  it('excludes only declared pixels and rejects invalid or total masks', () => {
    const half = Uint8Array.from(black);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) half.fill(255, (y * 8 + x) * 3, (y * 8 + x + 1) * 3);
    expect(glassMetrics(black, half, 8, 8).deltaEOver3Percent).toBe(50);
    expect(glassMetrics(black, half, 8, 8, [{ x: 0, y: 0, width: 4, height: 8 }])).toEqual({
      ssim: 1,
      deltaEOver3Percent: 0,
    });
    expect(() => glassMetrics(black, half, 8, 8, [{ x: 0, y: 0, width: 8, height: 8 }])).toThrow('entire image');
    expect(() => glassMetrics(black, half, 8, 8, [{ x: 7, y: 0, width: 2, height: 1 }])).toThrow('Invalid mask');
  });
});
