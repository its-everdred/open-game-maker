import { expect, it, vi } from 'vitest';
import { beginImageDraws, imageDraws, imageDrawsReady, reportImageDraw, resetImageDraws } from './image-draws.js';

it('reports only the current UI frame and returns a snapshot', () => {
  beginImageDraws();
  reportImageDraw({
    id: 'button',
    file: 'button.png',
    source: { width: 90, height: 30 },
    drawn: { width: 30, height: 30 },
  });
  const snapshot = imageDraws();
  expect(snapshot).toHaveLength(1);
  snapshot[0]!.drawn.width = 99;
  expect(imageDraws()[0]!.drawn.width).toBe(30);
  beginImageDraws();
  expect(imageDraws()).toEqual([]);
});

it('does not attest a missing or stale frame', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
  try {
    resetImageDraws();
    expect(imageDrawsReady()).toBe(false);
    beginImageDraws();
    expect(imageDrawsReady()).toBe(true);
    clock.mockReturnValue(1_100);
    expect(imageDrawsReady()).toBe(false);
  } finally {
    clock.mockRestore();
    resetImageDraws();
  }
});

it('preserves the measured frame while capture is paused', () => {
  const capture = window as unknown as { __gmCapturePausedAt?: number };
  try {
    beginImageDraws();
    reportImageDraw({
      id: 'before',
      file: 'a.png',
      source: { width: 30, height: 30 },
      drawn: { width: 30, height: 30 },
    });
    capture.__gmCapturePausedAt = performance.now();
    beginImageDraws();
    reportImageDraw({
      id: 'after',
      file: 'b.png',
      source: { width: 30, height: 30 },
      drawn: { width: 30, height: 30 },
    });
    expect(imageDraws().map((draw) => draw.id)).toEqual(['before']);
  } finally {
    delete capture.__gmCapturePausedAt;
    resetImageDraws();
  }
});
