import { buildIndex, buildMapIndex, writeMapIndex, writeMapLayouts } from '@ogm/asset-cards';

import { EXIT, type GmCommand } from '../../command.js';
import { printJson, requireAssetsRoot } from '../../context.js';
import { indexedSpecs } from '../../maps/specs.js';

export const command: GmCommand = {
  name: 'maps index',
  summary: 'rebuild the map-inspiration index: one layout row per map and tileset resource an agent may build from',
  usage: '[--json]',
  example: 'maps index --json',
  flags: {},
  async run(ctx) {
    const root = requireAssetsRoot(ctx);
    const index = await buildIndex(root);
    const { specs, invalid } = await indexedSpecs(root, index);
    const { maps, hidden } = buildMapIndex(index, specs);
    const [path] = await Promise.all([writeMapIndex(root, maps), writeMapLayouts(root, maps, specs)]);
    const summary = {
      rows: maps.rows.length,
      maps: maps.rows.filter((row) => row.resource === 'map').length,
      tilesets: maps.rows.filter((row) => row.resource === 'tileset').length,
      with_layout: maps.rows.filter((row) => row.from === 'spec').length,
      hidden,
      invalid: invalid.length,
      cards: index.cards.length,
      errors: index.errors.length,
    };
    if (ctx.json) printJson(ctx, { ...summary, path });
    else {
      ctx.out(
        `${summary.maps} maps, ${summary.tilesets} tilesets (${summary.with_layout} with a layout spec) -> ${path}`,
      );
      if (hidden > 0) ctx.out(`hidden: ${hidden} resources (a map needs derive-layout, a tileset in-game)`);
    }
    if (summary.errors > 0) for (const error of index.errors) ctx.err(`${error.path}: ${error.errors.join('; ')}`);
    for (const line of invalid) ctx.err(`invalid: ${line}`);
    ctx.emit('maps.index', summary);
    // Card validation is `gm packs index`'s verdict; this command's job is the layout file, which it just wrote.
    return EXIT.ok;
  },
};
