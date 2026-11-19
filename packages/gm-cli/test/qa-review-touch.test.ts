import { afterEach, describe, expect, it, vi } from 'vitest';

import { swipeReviewMedia } from '../src/qa-review-touch.js';

type Page = Parameters<typeof swipeReviewMedia>[0];

afterEach(() => vi.unstubAllGlobals());

function fixture(covered = false) {
  const panel = {
    parentElement: null,
    clientLeft: 0,
    clientTop: 0,
    clientWidth: 300,
    clientHeight: 80,
    getBoundingClientRect: () => ({ left: 30, top: 300, right: 330, bottom: 380 }),
  };
  const image = {
    parentElement: panel,
    getBoundingClientRect: () => ({ left: 30, top: 120, right: 310, bottom: 420 }),
    contains: () => false,
  };
  vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
  vi.stubGlobal('HTMLVideoElement', class {});
  vi.stubGlobal('getComputedStyle', () => ({ overflowX: 'clip', overflowY: 'clip' }));
  vi.stubGlobal('document', {
    elementFromPoint: (x: number, y: number) => (!covered && x >= 30 && x < 310 && y >= 300 && y < 380 ? image : null),
  });
  const send = vi.fn(async () => {});
  const media = {
    first() {
      return this;
    },
    scrollIntoViewIfNeeded: async () => {},
    boundingBox: async () => ({ x: 30, y: 120, width: 280, height: 300 }),
    evaluate: async (fn: (element: Element) => unknown) => fn(image as unknown as Element),
  };
  const page = {
    getByRole: () => ({ locator: () => media }),
    context: () => ({ newCDPSession: async () => ({ send, detach: async () => {} }) }),
  } as unknown as Page;
  return { page, send };
}

describe('review QA touch targeting', () => {
  it('starts the gesture inside the visible part of clipped media', async () => {
    const { page, send } = fixture();
    await swipeReviewMedia(page, false, '.worker-review-option img');
    expect(send).toHaveBeenCalledWith('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 170, y: 340 }],
    });
    expect(send).toHaveBeenLastCalledWith('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });

  it('fails instead of claiming a swipe when the media is covered', async () => {
    const { page, send } = fixture(true);
    await expect(swipeReviewMedia(page, false, '.worker-review-option img')).rejects.toThrow(
      'swipe point is not visible and reachable',
    );
    expect(send).not.toHaveBeenCalled();
  });
});
