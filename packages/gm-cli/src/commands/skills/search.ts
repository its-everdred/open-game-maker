import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { catalogRoot, readCatalog, searchCatalog } from '../../skills/catalog.js';

export const command: GmCommand = {
  name: 'skills search',
  summary: 'find on-demand skills by words in their name or description',
  usage: '<words…>',
  example: 'skills search camera shake',
  flags: {},
  async run(ctx, args) {
    if (args.length === 0) throw new UsageError('gm skills search needs at least one word', 'gm help skills search');
    const hits = searchCatalog(readCatalog(catalogRoot(ctx.cwd, ctx.skillsDir)), args);
    if (hits.length === 0) {
      ctx.err(`no skill matches ${args.join(' ')}`);
      return EXIT.failed;
    }
    for (const hit of hits.slice(0, ctx.limit))
      ctx.out(
        ctx.json ? JSON.stringify({ name: hit.name, description: hit.description }) : `${hit.name}  ${hit.description}`,
      );
    if (!ctx.json && hits.length > ctx.limit) ctx.out(`+${hits.length - ctx.limit} more  (--limit ${hits.length})`);
    return EXIT.ok;
  },
};
