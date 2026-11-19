type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;
type Page = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['newPage']>>;

/** Start a review swipe inside the visible, hit-testable part of its media. */
export async function swipeReviewMedia(page: Page, right: boolean, selector = '.review-deck-playable'): Promise<void> {
  const media = page.getByRole('dialog', { name: 'Needs Review' }).locator(selector).first();
  await media.scrollIntoViewIfNeeded();
  const point = await media.evaluate(touchPoint);
  if (typeof point === 'string') throw new Error('the review card swipe point is not visible and reachable');
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    for (let step = 1; step <= 5; step++) {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point.x + (right ? 22 : -22) * step, y: point.y }],
      });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await touch.detach();
  }
}

function touchPoint(element: Element): { x: number; y: number } | 'offscreen' | 'covered' {
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left);
  let rightEdge = Math.min(window.innerWidth, rect.right);
  let top = Math.max(0, rect.top);
  let bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (/^(auto|scroll|hidden|clip)$/u.test(style.overflowX)) {
      left = Math.max(left, bounds.left + parent.clientLeft);
      rightEdge = Math.min(rightEdge, bounds.left + parent.clientLeft + parent.clientWidth);
    }
    if (/^(auto|scroll|hidden|clip)$/u.test(style.overflowY)) {
      top = Math.max(top, bounds.top + parent.clientTop);
      bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
    }
  }
  // The bottom of a video is reserved for native playback controls.
  if (element instanceof HTMLVideoElement) bottom = Math.min(bottom, rect.bottom - 48);
  if (rightEdge <= left || bottom <= top) return 'offscreen';
  const x = (left + rightEdge) / 2;
  const y = (top + bottom) / 2;
  const hit = document.elementFromPoint(x, y);
  return hit &&
    (hit === element || element.contains(hit) || (hit === element.parentElement && hit.tagName === 'BUTTON'))
    ? { x, y }
    : 'covered';
}
