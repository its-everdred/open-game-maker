import { loadMapIndex, loadMapLayout } from '@ogm/asset-cards';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson, requireAssetsRoot } from '../../context.js';

export const command: GmCommand = {
  name: 'maps info',
  summary: 'read the validated layout graph for one searchable inspiration map',
  usage: '<map-card-id> [--json]',
  example: 'maps info t1:cc0-dungeon-maps/roads-of-the-old-crypt@v1 --json',
  flags: {},
  async run(ctx, args) {
    if (args.length !== 1) throw new UsageError('give one map card id', 'gm maps info <map-card-id> --json');
    const id = args[0]!;
    const root = requireAssetsRoot(ctx);
    const row = (await loadMapIndex(root)).rows.find((candidate) => candidate.id === id);
    if (!row || row.resource !== 'map') {
      throw new UsageError(`map "${id}" is not in the searchable inspiration index`, 'gm maps search --maps <words>');
    }

    if (row.from !== 'spec' || row.layout_id === null) {
      throw new CommandError(`map "${id}" has no validated layout graph; choose another result from gm maps search`);
    }
    const spec = await loadMapLayout(root, id, row.layout_id);
    if (!spec) throw new CommandError(`map "${id}" has no validated layout graph; rebuild with gm maps index`);
    if (ctx.json) printJson(ctx, spec);
    else {
      const counts = spec.tags.computed;
      ctx.out(
        `${spec.id}  ${counts.room_count} rooms  ${counts.connection_count} connections  ${counts.loop_count} loops  ${counts.secret_count} secrets`,
      );
    }
    ctx.emit('maps.info', { id, layout: spec.id });
    return EXIT.ok;
  },
};
