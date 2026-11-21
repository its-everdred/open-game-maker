type Point = { x: number; y: number };
export type SceneRoute = { id: string; waypoints: readonly Point[] };
export type WalkableGrid = { width: number; height: number; cells: readonly boolean[] };

/** Check ordered routes against the actual game grid and the new solid footprints. */
export function validateSceneRoutes(
  grid: WalkableGrid,
  collision: readonly Point[],
  routes: readonly SceneRoute[],
): void {
  const { width, height, cells } = grid;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 1_000_000 ||
    cells.length !== width * height ||
    cells.some((value) => typeof value !== 'boolean') ||
    routes.length > 32
  )
    throw new Error('invalid scene route grid');
  const inside = ({ x, y }: Point) =>
    Number.isSafeInteger(x) && Number.isSafeInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  const blocked = new Set<number>();
  for (const point of collision) {
    if (!inside(point)) throw new Error('invalid scene collision cell');
    blocked.add(point.y * width + point.x);
  }
  const ids = new Set<string>();
  for (const route of routes) {
    if (
      !route.id ||
      ids.has(route.id) ||
      route.waypoints.length < 2 ||
      route.waypoints.length > 32 ||
      route.waypoints.some((point) => !inside(point))
    )
      throw new Error('invalid scene route');
    ids.add(route.id);
    const indexes = route.waypoints.map(({ x, y }) => y * width + x);
    if (indexes.some((index) => !cells[index] || blocked.has(index)))
      throw new Error(`scene route ${route.id} has a blocked waypoint`);
    for (let leg = 1; leg < indexes.length; leg++) {
      const start = indexes[leg - 1]!,
        goal = indexes[leg]!;
      const seen = new Uint8Array(cells.length),
        queue = new Int32Array(cells.length);
      let head = 0,
        tail = 0;
      queue[tail++] = start;
      seen[start] = 1;
      while (head < tail && !seen[goal]) {
        const current = queue[head++]!,
          x = current % width,
          y = Math.floor(current / width);
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ]) {
          if (nx! < 0 || ny! < 0 || nx! >= width || ny! >= height) continue;
          const next = ny! * width + nx!;
          if (!seen[next] && cells[next] && !blocked.has(next)) {
            seen[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      if (!seen[goal]) throw new Error(`scene route ${route.id} is disconnected`);
    }
  }
}
