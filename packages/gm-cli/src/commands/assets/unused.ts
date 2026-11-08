import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { readLock } from '../../lock.js';
import { isReferenced, scanReferences } from '../../references.js';

export const command: GmCommand = {
  name: 'assets unused',
  summary: "entries in ./assets.lock.json that the game's src/ and index.html no longer reference",
  example: 'assets unused --json',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError('assets unused takes no arguments', 'gm assets unused');
    const lock = await readLock(ctx.cwd);
    if (lock === null) {
      ctx.err('no assets.lock.json here');
      ctx.emit('assets.unused', { entries: 0, unused: 0 });
      return EXIT.ok;
    }
    const references = await scanReferences(ctx.cwd);
    const unused = lock.assets.filter((entry) => !isReferenced(entry, references));
    for (const entry of unused) {
      if (ctx.json) printJson(ctx, { id: entry.id, path: entry.path });
      else ctx.out(`${entry.id}  ${entry.path}`);
    }
    ctx.emit('assets.unused', { entries: lock.assets.length, unused: unused.length });
    return EXIT.ok;
  },
};
