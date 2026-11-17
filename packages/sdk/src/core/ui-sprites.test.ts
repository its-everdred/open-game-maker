import { afterEach, expect, it, vi } from 'vitest';
import { reportUiSprites } from './ui-sprites.js';

afterEach(() => vi.unstubAllGlobals());

it('exposes current sprite bounds and removes only its own reporter', () => {
  const frame = {};
  vi.stubGlobal('window', frame);
  let left = 10;
  const stop = reportUiSprites(() => [{ name: 'HOLD', left, top: 2, width: 3, height: 4 }]);
  const reporter = frame as { __gmUiSprites?: () => { left: number }[] };
  expect(reporter.__gmUiSprites?.()[0]?.left).toBe(10);
  left = 20;
  expect(reporter.__gmUiSprites?.()[0]?.left).toBe(20);
  const stopNew = reportUiSprites(() => []);
  stop();
  expect(reporter.__gmUiSprites).toBeDefined();
  stopNew();
  expect(reporter.__gmUiSprites).toBeUndefined();
});
