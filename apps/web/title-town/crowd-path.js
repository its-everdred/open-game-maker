// Deterministic grid paths for ground-level townsfolk. Obstacles are oriented
// rectangles expanded by the person's radius; a failed route is never crossed.
export function blocked(point, obstacles) {
  return obstacles.some(({ x, z, yaw, halfX, halfZ, cos, sin }) => {
    const dx = point[0] - x, dz = point[1] - z;
    if (Math.abs(dx) > halfX + halfZ || Math.abs(dz) > halfX + halfZ) return false;
    const c = cos ?? Math.cos(yaw), s = sin ?? Math.sin(yaw);
    return Math.abs(dx * c - dz * s) <= halfX && Math.abs(dx * s + dz * c) <= halfZ;
  });
}

function intersects(from, to, o) {
  const radius = o.halfX + o.halfZ;
  if (o.x + radius < Math.min(from[0], to[0]) || o.x - radius > Math.max(from[0], to[0]) ||
      o.z + radius < Math.min(from[1], to[1]) || o.z - radius > Math.max(from[1], to[1])) return false;
  const c = o.cos ?? Math.cos(o.yaw), s = o.sin ?? Math.sin(o.yaw);
  const local = v => [(v[0] - o.x) * c - (v[1] - o.z) * s, (v[0] - o.x) * s + (v[1] - o.z) * c];
  const a = local(from), b = local(to); let lo = 0, hi = 1;
  for (let axis = 0; axis < 2; axis++) {
    const half = axis ? o.halfZ : o.halfX, delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-9) { if (Math.abs(a[axis]) > half) return false; continue; }
    const t0 = (-half - a[axis]) / delta, t1 = (half - a[axis]) / delta;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi) return false;
  }
  return true;
}

const obstacleIndexes = new WeakMap();

export function route(start, end, obstacles, step = 1.5, maxVisited = 1000) {
  if (start.length !== 2 || end.length !== 2 || ![...start, ...end, step].every(Number.isFinite) || step <= 0) return null;
  const signature = obstacles.map(o => [o.x, o.z, o.yaw, o.halfX, o.halfZ].join(',')).join(';');
  let index = obstacleIndexes.get(obstacles);
  if (!index || index.signature !== signature) {
    const prepared = obstacles.map(o => ({ ...o, cos: Math.cos(o.yaw), sin: Math.sin(o.yaw) }));
    const cells = new Map(), cellSize = 12, cellKey = (x, z) => `${x},${z}`;
    for (const o of prepared) {
      const radius = o.halfX + o.halfZ;
      for (let x = Math.floor((o.x - radius) / cellSize); x <= Math.floor((o.x + radius) / cellSize); x++)
        for (let z = Math.floor((o.z - radius) / cellSize); z <= Math.floor((o.z + radius) / cellSize); z++) {
          const k = cellKey(x, z); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(o);
        }
    }
    index = { prepared, cells, cellSize, cellKey, signature, edges: new Map() }; obstacleIndexes.set(obstacles, index);
  }
  const { prepared, cells, cellSize, cellKey } = index;
  obstacles = prepared;
  const isBlocked = p => blocked(p, cells.get(cellKey(Math.floor(p[0] / cellSize), Math.floor(p[1] / cellSize))) || []);
  const snap = p => p.map(v => Math.round(v / step));
  const origin = snap(start), target = snap(end), key = (x, z) => `${x},${z}`;
  const point = (x, z) => [x * step, z * step];
  const nearest = p => {
    for (let r = 0; r <= 20; r++) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
      const q = [p[0] + x, p[1] + z];
      if (!isBlocked(point(...q))) return q;
    }
    return null;
  };
  const a = nearest(origin), b = nearest(target);
  if (!a || !b) return null;
  // Intersect the complete segment with each expanded rectangle. Sampling can
  // miss a short corner crossing between frames.
  const clearLine = (p, q) => {
    const from = point(...p), to = point(...q), short = Math.hypot(to[0] - from[0], to[1] - from[1]) < step * 2;
    const endpoints = [key(...p), key(...q)].sort(), edge = `${step}:${endpoints.join(':')}`;
    if (short && index.edges.has(edge)) return index.edges.get(edge);
    let candidates = obstacles;
    if (short) {
      const nearby = new Set();
      for (let x = Math.floor(Math.min(from[0], to[0]) / cellSize) - 1; x <= Math.floor(Math.max(from[0], to[0]) / cellSize) + 1; x++)
        for (let z = Math.floor(Math.min(from[1], to[1]) / cellSize) - 1; z <= Math.floor(Math.max(from[1], to[1]) / cellSize) + 1; z++)
          for (const o of cells.get(cellKey(x, z)) || []) nearby.add(o);
      candidates = [...nearby];
    }
    const clear = !candidates.some(o => intersects(from, to, o));
    if (short) index.edges.set(edge, clear);
    return clear;
  };
  if (a[0] === b[0] && a[1] === b[1]) return [point(...a)];
  if (clearLine(a, b)) return [point(...a), point(...b)];
  const score = n => n.g + Math.hypot(n.x - b[0], n.z - b[1]);
  const open = [], push = node => {
    let i = open.push(node) - 1;
    while (i) { const parent = Math.floor((i - 1) / 2); if (score(open[parent]) <= score(node)) break; open[i] = open[parent]; i = parent; }
    open[i] = node;
  }, pop = () => {
    const first = open[0], last = open.pop();
    if (open.length) { let i = 0; while (i * 2 + 1 < open.length) { let child = i * 2 + 1; if (child + 1 < open.length && score(open[child + 1]) < score(open[child])) child++; if (score(last) <= score(open[child])) break; open[i] = open[child]; i = child; } open[i] = last; }
    return first;
  };
  const startKey = key(...a), endKey = key(...b), best = new Map([[startKey, 0]]), parent = new Map();
  push({ x: a[0], z: a[1], g: 0 });
  const minX = Math.min(a[0], b[0]) - 30, maxX = Math.max(a[0], b[0]) + 30;
  const minZ = Math.min(a[1], b[1]) - 30, maxZ = Math.max(a[1], b[1]) + 30;
  let closest = startKey, distance = Math.hypot(a[0] - b[0], a[1] - b[1]), visited = 0;
  const trace = end => {
    const path = []; let k = end;
    while (k) { const [x, z] = k.split(',').map(Number); path.push([x, z]); k = parent.get(k); }
    path.reverse(); const reduced = [path[0]];
    for (let i = 0; i < path.length - 1;) {
      let j = path.length - 1; while (j > i + 1 && !clearLine(path[i], path[j])) j--;
      reduced.push(path[j]); i = j;
    }
    return reduced.map(p => point(...p));
  };
  while (open.length && visited++ < maxVisited) {
    const cur = pop(), here = key(cur.x, cur.z);
    if (cur.g !== best.get(here)) continue;
    if (here === endKey) return trace(here);
    const remaining = Math.hypot(cur.x - b[0], cur.z - b[1]);
    if (remaining < distance) { closest = here; distance = remaining; }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const x = cur.x + dx, z = cur.z + dz;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      if (!clearLine([cur.x, cur.z], [x, z])) continue;
      const next = key(x, z), g = cur.g + Math.hypot(dx, dz);
      if (g >= (best.get(next) ?? Infinity)) continue;
      best.set(next, g); parent.set(next, here); push({ x, z, g });
    }
  }
  return trace(closest);
}

// Test an entire world-space segment, including both endpoints.
export function clearSegment(from, to, obstacles) {
  return !obstacles.some(o => intersects(from, to, o));
}

// Remove unnecessary bends from an already safe path, without crossing a blocker.
export function simplifyPath(path, obstacles) {
  const clear = (a, b) => clearSegment(a, b, obstacles);
  if (path.length < 2) return path.slice();
  const out = [path[0]];
  for (let i = 0; i < path.length - 1;) {
    let j = path.length - 1; while (j > i + 1 && !clear(path[i], path[j])) j--;
    out.push(path[j]); i = j;
  }
  return out;
}
