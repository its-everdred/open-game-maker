/** Geometry is expressed in CSS pixels in the viewport coordinate system. */
export type PlayAreaGeometry = {
  viewport: { width: number; height: number };
  board: { left: number; top: number; width: number; height: number };
  safe: { top: number; right: number; bottom: number; left: number };
  controls: { top: number; bottom: number };
};

export type PlayAreaLimits = { minFill: number; maxOffset: number };

export function matchesPlayAreaAspect(board: PlayAreaGeometry['board'], aspect: number): boolean {
  return Math.abs(board.width - board.height * aspect) <= 2;
}

/** A fixed-aspect board can fill only the portion that fits in the usable viewport. */
export function fixedAspectMinimumFill(geometry: PlayAreaGeometry, aspect: number): number {
  const height =
    geometry.viewport.height -
    geometry.safe.top -
    geometry.safe.bottom -
    geometry.controls.top -
    geometry.controls.bottom;
  const width = geometry.viewport.width - geometry.safe.left - geometry.safe.right;
  if (!Number.isFinite(aspect) || aspect <= 0 || height <= 0 || width <= 0) throw new Error('invalid play-area aspect');
  return 0.9 * Math.min(1, width / aspect / height);
}

/** Measure height against available vertical space and centring against usable width. */
export function measurePlayArea(
  geometry: PlayAreaGeometry,
  limits: PlayAreaLimits = { minFill: 0.9, maxOffset: 0.05 },
) {
  const { viewport, board, safe, controls } = geometry;
  const values = [
    viewport.width,
    viewport.height,
    board.left,
    board.top,
    board.width,
    board.height,
    safe.top,
    safe.right,
    safe.bottom,
    safe.left,
    controls.top,
    controls.bottom,
    limits.minFill,
    limits.maxOffset,
  ];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    [viewport.width, viewport.height, board.width, board.height].some((value) => value <= 0) ||
    [
      safe.top,
      safe.right,
      safe.bottom,
      safe.left,
      controls.top,
      controls.bottom,
      limits.minFill,
      limits.maxOffset,
    ].some((value) => value < 0) ||
    limits.minFill > 1 ||
    limits.maxOffset > 1
  )
    throw new Error('invalid play-area geometry or limits');
  const usableHeight = viewport.height - safe.top - safe.bottom - controls.top - controls.bottom;
  const usableWidth = viewport.width - safe.left - safe.right;
  if (usableHeight <= 0 || usableWidth <= 0) throw new Error('play area has no usable viewport');
  const usableTop = safe.top + controls.top;
  const usableBottom = viewport.height - safe.bottom - controls.bottom;
  const visibleHeight = Math.max(0, Math.min(board.top + board.height, usableBottom) - Math.max(board.top, usableTop));
  const fill = visibleHeight / usableHeight;
  const offset = Math.abs(board.left + board.width / 2 - (safe.left + usableWidth / 2)) / usableWidth;
  const horizontallyContained =
    board.left >= safe.left - 1 && board.left + board.width <= viewport.width - safe.right + 1;
  const verticallyContained = board.top >= usableTop - 1 && board.top + board.height <= usableBottom + 1;
  return {
    fill,
    offset,
    ok: fill >= limits.minFill && offset <= limits.maxOffset && horizontallyContained && verticallyContained,
  };
}
