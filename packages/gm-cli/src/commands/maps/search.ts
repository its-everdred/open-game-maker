import { loadMapIndex } from '@ogm/asset-cards';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson, requireAssetsRoot } from '../../context.js';
import { clipScores } from '../../maps/clip.js';
import {
  FLOWS,
  GRIDS,
  SCALES,
  SIZES,
  facetLine,
  layoutLine,
  matchRow,
  parseRowQuery,
  type RowQuery,
} from '../../maps/rows.js';

function oneOf(name: string, values: string[], given: string[]): void {
  const bad = given.find((value) => !values.includes(value));
  if (bad !== undefined) throw new UsageError(`unknown ${name} "${bad}"`, `gm maps search --${name} ${values[0]}`);
}

export const command: GmCommand = {
  name: 'maps search',
  summary: 'find maps and tilesets by layout columns: biome, feature, scale, grid, rooms, loops, secrets',
  usage:
    '"<words>" [--biome <env>] [--feature <name>] [--scale <class>] [--grid <type>] [--rooms 3-5] [--loops N] [--secret] [--size small] [--type crypt]',
  example: 'maps search "small crypt 3-5 rooms one loop secret door"',
  flags: {
    rooms: { type: 'string', help: 'room count or range (3-5); rows with no layout spec do not match' },
    loops: { type: 'number', help: 'exactly N loops' },
    secret: { type: 'boolean', default: false, help: 'at least one secret door' },
    levels: { type: 'number', help: 'at least N floors' },
    size: { type: 'string', help: `size class (${SIZES.join(', ')})` },
    type: { type: 'string', multiple: true, help: 'map type, or a tileset set/family (repeatable)' },
    biome: { type: 'string', multiple: true, help: 'environment word: crypt, forest, town (repeatable)' },
    feature: { type: 'string', multiple: true, help: 'a drawn feature: water, road, stairs, altar (repeatable)' },
    scale: { type: 'string', multiple: true, help: `map scale (${SCALES.join(', ')})` },
    grid: { type: 'string', multiple: true, help: `grid type (${GRIDS.join(', ')})` },
    flow: { type: 'string', multiple: true, help: `layout flow (${FLOWS.join(', ')})` },
    tilesets: { type: 'boolean', default: false, help: 'only tilesets a map can be drawn with' },
    maps: { type: 'boolean', default: false, help: 'only map layouts' },
  },
  async run(ctx, args, flags) {
    const root = requireAssetsRoot(ctx);
    let q: RowQuery;
    try {
      q = parseRowQuery(args, flags);
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error), 'gm maps search --rooms 3-5');
    }
    oneOf('size', SIZES, q.size ? [q.size] : []);
    oneOf('scale', SCALES, q.scales);
    oneOf('grid', GRIDS, q.grids);
    oneOf('flow', FLOWS, q.flows);

    const index = await loadMapIndex(root);
    if (index.rows.length === 0) {
      ctx.err('no map index yet: run `gm maps index` (or `gm packs index`) to build it');
      ctx.emit('maps.search', { args, rows: 0, built: false });
      return EXIT.failed;
    }
    const matched: { row: (typeof index.rows)[number]; score: number; semantic?: number }[] = [];
    for (const row of index.rows) {
      const { hard, score } = matchRow(row, q);
      if (hard) matched.push({ row, score });
    }
    if (flags.maps === true && args.length > 0) {
      const scores = await clipScores(
        root,
        args.join(' '),
        matched.map(({ row }) => row),
        ctx.home,
      );
      if (scores === null || scores.size === 0) ctx.err('CLIP search unavailable; ranking by indexed text only');
      else
        for (const match of matched) {
          const semantic = scores.get(match.row.id);
          if (semantic !== undefined) {
            match.semantic = semantic;
            match.score += (semantic + 1) * 1.5;
          }
        }
    }
    matched.sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.semantic !== undefined) - Number(a.semantic !== undefined) ||
        (a.row.id < b.row.id ? -1 : 1),
    );
    const shown = matched.slice(0, ctx.limit);
    for (const { row } of shown) {
      if (ctx.json) printJson(ctx, row);
      else ctx.out(layoutLine(row));
    }
    if (shown.length === 0 && !ctx.json) ctx.err('no matches');
    if (!ctx.json)
      ctx.err(
        facetLine(
          shown.length,
          matched.length,
          matched.map(({ row }) => row),
        ),
      );
    ctx.emit('maps.search', { args, rows: matched.length, built: index.built });
    return EXIT.ok;
  },
};
