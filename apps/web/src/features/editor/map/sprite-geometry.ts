/** Pixel bounds of a uniformly scaled sprite anchored at a map point. */
export function spriteBounds(
  center: { x: number; y: number },
  anchorY: number,
  size: { width: number; height: number },
  scale = 1,
) {
  return {
    x: center.x - (size.width * scale) / 2,
    y: center.y - anchorY * scale,
    width: size.width * scale,
    height: size.height * scale,
  };
}

/** Convert a map pixel to its source-image coordinates for alpha hit testing. */
export function spritePixelAt(point: { x: number; y: number }, bounds: { x: number; y: number }, scale = 1) {
  return { x: (point.x - bounds.x) / scale, y: (point.y - bounds.y) / scale };
}
