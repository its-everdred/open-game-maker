import { z } from 'zod';
import { parseSceneBrief } from './brief.js';

const id = z.string().trim().min(1).max(80);
const cell = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strict();
const cells = z.array(cell).min(1).max(10000).nullable();
const anchor = z
  .object({
    id,
    region: id,
    role: z.enum(['gate', 'door']),
    cell: cell.nullable(),
    facing: z.enum(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']).nullable(),
  })
  .strict();
const structure = z.discriminatedUnion('kind', [
  z.object({ id, region: id, kind: z.literal('edge-run'), cells, openings: z.array(id).max(1000) }).strict(),
  z.object({ id, region: id, kind: z.literal('building'), footprint: cells, door: id }).strict(),
  z.object({ id, region: id, kind: z.literal('path'), cells, from: id, to: id }).strict(),
]);
const inputSchema = z
  .object({
    mockSha256: z.string().regex(/^[a-f0-9]{64}$/),
    grid: z
      .object({ width: z.number().int().positive().max(10000), height: z.number().int().positive().max(10000) })
      .strict()
      .nullable(),
    anchors: z.array(anchor).max(1000),
    structures: z.array(structure).max(1000),
  })
  .strict();

/** Preserve reviewed structure relationships without selecting or placing pack sprites. */
export function sceneStructureIntent(briefInput: unknown, intentInput: unknown) {
  const brief = parseSceneBrief(briefInput);
  const intent = inputSchema.parse(intentInput);
  const regions = new Set(brief.regions.map((region) => region.id));
  const anchors = new Map<string, z.infer<typeof anchor>>();
  const ids = new Set<string>();
  const validateCell = (point: z.infer<typeof cell>) => {
    if (!intent.grid || point.x >= intent.grid.width || point.y >= intent.grid.height)
      throw new Error('structure cell has no valid grid');
  };
  for (const item of intent.anchors) {
    if (!regions.has(item.region) || ids.has(item.id)) throw new Error('invalid or duplicate intent anchor');
    ids.add(item.id);
    if (item.cell) validateCell(item.cell);
    anchors.set(item.id, item);
  }
  const validateCells = (points: z.infer<typeof cells>) => {
    if (points === null) return;
    const seen = new Set<string>();
    for (const point of points) {
      validateCell(point);
      const key = `${point.x},${point.y}`;
      if (seen.has(key)) throw new Error('duplicate structure cell');
      seen.add(key);
    }
  };
  for (const item of intent.structures) {
    if (!regions.has(item.region) || ids.has(item.id)) throw new Error('invalid or duplicate structure');
    ids.add(item.id);
    if (item.kind === 'edge-run') {
      validateCells(item.cells);
      if (
        new Set(item.openings).size !== item.openings.length ||
        item.openings.some((key) => anchors.get(key)?.role !== 'gate')
      )
        throw new Error('edge run has invalid gate references');
    } else if (item.kind === 'building') {
      validateCells(item.footprint);
      if (anchors.get(item.door)?.role !== 'door') throw new Error('building has invalid door reference');
    } else {
      validateCells(item.cells);
      if (!anchors.has(item.from) || !anchors.has(item.to) || item.from === item.to)
        throw new Error('path has invalid endpoint references');
      if (item.cells) {
        for (let i = 1; i < item.cells.length; i++) {
          const a = item.cells[i - 1]!;
          const b = item.cells[i]!;
          if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) throw new Error('path cells are disconnected');
        }
        const from = anchors.get(item.from)!.cell;
        const to = anchors.get(item.to)!.cell;
        if (
          (from && (item.cells[0]!.x !== from.x || item.cells[0]!.y !== from.y)) ||
          (to && (item.cells.at(-1)!.x !== to.x || item.cells.at(-1)!.y !== to.y))
        )
          throw new Error('path cells do not meet their anchors');
      }
    }
  }
  return intent;
}
