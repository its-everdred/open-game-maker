import type { Grid } from './grid.js';
import { NEIGHBORS, across, cellKey, type Actor, type Cell, type Finding } from './model.js';

const START = /^(player|spawn|start|entry)$/i;

/** The player's spawn: a `player` prefab, else a spawn named player/spawn/start/entry, else the first spawn. */
export function spawnOf(actors: readonly Actor[]): Actor | undefined {
  return actors.find((a) => a.prefab === 'player') ?? actors.find((a) => START.test(a.name)) ?? actors[0];
}

interface Target {
  label: string;
  cells: Cell[];
  object: string;
}

/** The spawn reaches every entry, door, NPC and exit, and every path touches two of those places. */
export function traversable(grid: Grid): Finding[] {
  const spawn = spawnOf(grid.scene.actors);
  if (!spawn) {
    return [
      {
        check: 'traversable',
        id: 'traversable/no-spawn',
        severity: 'high',
        message: 'scene has no spawn point, so nothing can be checked as reachable',
        cells: [],
        objects: [],
      },
    ];
  }
  const findings: Finding[] = [];
  const reach = grid.reach(spawn);
  if (!reach.size) {
    findings.push({
      check: 'traversable',
      id: 'traversable/spawn-blocked',
      severity: 'high',
      message: `spawn ${spawn.name} at (${spawn.x},${spawn.y}) is not on a walkable cell`,
      cells: [{ x: spawn.x, y: spawn.y }],
      objects: [spawn.id],
    });
    return findings;
  }
  const around = (cell: Cell) => [cell, ...NEIGHBORS.map(([dx, dy]) => ({ x: cell.x + dx, y: cell.y + dy }))];
  const targets: Target[] = grid.scene.actors
    .filter((actor) => actor !== spawn)
    .map((actor) => ({ label: actor.name, cells: grid.walkable(actor) ? [actor] : around(actor), object: actor.id }));
  for (const piece of grid.scene.pieces) {
    if (piece.role === 'door') {
      const cells = piece.edge ? [across(piece, piece.edge)] : around(piece);
      targets.push({ label: `door at (${piece.x},${piece.y})`, cells, object: piece.key });
    } else if (piece.role === 'opening' || piece.tags.has('gate') || piece.tags.has('exit')) {
      const label = piece.tags.has('exit') ? 'exit' : 'gate';
      targets.push({ label: `${label} at (${piece.x},${piece.y})`, cells: around(piece), object: piece.key });
    }
  }
  for (const target of targets) {
    if (target.cells.some((cell) => reach.has(cellKey(cell)))) continue;
    findings.push({
      check: 'traversable',
      id: 'traversable/unreachable',
      severity: 'high',
      message: `${target.label} cannot be reached from spawn ${spawn.name} over walkable cells`,
      cells: target.cells.slice(0, 1),
      objects: [target.object],
    });
  }
  const places = [[{ x: spawn.x, y: spawn.y }], ...targets.map((target) => target.cells)];
  const path = new Set(grid.scene.pieces.filter((p) => p.role === 'path').map(cellKey));
  const seen = new Set<string>();
  for (const start of path) {
    if (seen.has(start)) continue;
    const group: Cell[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const [x, y] = queue.pop()!.split(',').map(Number);
      group.push({ x: x!, y: y! });
      for (const [dx, dy] of NEIGHBORS) {
        const key = cellKey({ x: x! + dx, y: y! + dy });
        if (path.has(key) && !seen.has(key)) {
          seen.add(key);
          queue.push(key);
        }
      }
    }
    const near = new Set(group.flatMap((cell) => around(cell).map(cellKey)));
    const touched = places.filter((cells) => cells.some((cell) => near.has(cellKey(cell)))).length;
    if (touched >= 2) continue;
    findings.push({
      check: 'traversable',
      id: 'traversable/dead-path',
      severity: 'medium',
      message: `path of ${group.length} cell(s) starting at (${group[0]!.x},${group[0]!.y}) connects ${touched ? 'only one place' : 'nothing'}; lead it between entries, doors, gates or characters`,
      cells: group,
      objects: [],
    });
  }
  return findings;
}
