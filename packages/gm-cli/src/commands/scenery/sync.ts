import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DesignDocSchema } from '@ogm/contracts';
import { sceneryFromDesign } from '@gm/sdk/scenery';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { readLock } from '../../lock.js';
import { writeScene } from '../../scenery/files.js';

export const command: GmCommand = {
  name: 'scenery sync',
  summary: 'save scenery from an effective editor design snapshot',
  usage: '--design <snapshot.json>',
  flags: { design: { type: 'string', help: 'effective design snapshot from gm design current' } },
  async run(ctx, args, flags) {
    if (args.length || typeof flags.design !== 'string')
      throw new UsageError('give a design snapshot', 'gm scenery sync --design .gm/context/design.json');
    const lock = await readLock(ctx.cwd);
    if (!lock) throw new CommandError('assets.lock.json is required to sync scenery');
    try {
      const input: unknown = JSON.parse(await readFile(resolve(ctx.cwd, flags.design), 'utf8'));
      const doc = DesignDocSchema.parse(input && typeof input === 'object' && 'doc' in input ? input.doc : input);
      await writeScene(ctx.cwd, sceneryFromDesign(doc, lock.assets), lock.assets);
    } catch (error) {
      throw new CommandError(`cannot sync scenery: ${error instanceof Error ? error.message : String(error)}`);
    }
    ctx.out('synced scenery.json');
    return EXIT.ok;
  },
};
