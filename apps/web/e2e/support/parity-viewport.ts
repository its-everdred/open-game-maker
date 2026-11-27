export function intersectsViewport(
  box: { x: number; y: number; width: number; height: number } | null,
  viewport: { width: number; height: number },
): boolean {
  return !!box && box.x < viewport.width && box.y < viewport.height && box.x + box.width > 0 && box.y + box.height > 0;
}
