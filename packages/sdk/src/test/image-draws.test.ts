import { expect, it } from 'vitest';
import { beginImageDraws, imageDraws, reportImageDraw } from './image-draws.js';

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
