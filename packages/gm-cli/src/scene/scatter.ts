export type ScatterPoint = { x: number; y: number };
export type DensityGrid = { width: number; height: number; weights: readonly number[] };
export type ScatterOptions = { count: number; radius: number; seed: number; attemptsPerPoint?: number };

/** Sample a seeded density field; zero-weight cells exclude paths and other reserved areas. */
export function scatter(grid: DensityGrid, options: ScatterOptions): ScatterPoint[] {
  const { width, height, weights } = grid;
  const { count, radius, seed, attemptsPerPoint = 30 } = options;
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    width * height > 1_000_000 ||
    weights.length !== width * height ||
    weights.some((weight) => !Number.isFinite(weight) || weight < 0 || weight > 1) ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 100_000 ||
    !Number.isFinite(radius) ||
    radius < 0 ||
    !Number.isSafeInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isSafeInteger(attemptsPerPoint) ||
    attemptsPerPoint < 1 ||
    attemptsPerPoint > 1000 ||
    count * attemptsPerPoint > 1_000_000
  )
    throw new Error('invalid scatter field or options');
  if (weights.every((weight) => weight === 0)) return [];
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  const result: ScatterPoint[] = [];
  const cellSize = radius || 1;
  const cells = new Map<string, ScatterPoint[]>();
  for (let attempt = 0; attempt < count * attemptsPerPoint && result.length < count; attempt++) {
    const x = random() * width,
      y = random() * height;
    if (random() >= weights[Math.floor(y) * width + Math.floor(x)]!) continue;
    if (radius === 0) {
      result.push({ x, y });
      continue;
    }
    const cx = Math.floor(x / cellSize),
      cy = Math.floor(y / cellSize);
    let tooClose = false;
    for (let dy = -1; dy <= 1 && !tooClose; dy++)
      for (let dx = -1; dx <= 1 && !tooClose; dx++) {
        for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if ((other.x - x) ** 2 + (other.y - y) ** 2 < radius ** 2) {
            tooClose = true;
            break;
          }
        }
      }
    if (tooClose) continue;
    const point = { x, y },
      key = `${cx},${cy}`;
    result.push(point);
    const bucket = cells.get(key) ?? [];
    bucket.push(point);
    cells.set(key, bucket);
  }
  return result;
}
