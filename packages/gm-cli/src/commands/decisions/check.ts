import { readFileSync } from 'node:fs';
import { EXIT, type GmCommand } from '../../command.js';
import { inventoryFile, inventoryPath, readInventory, renderInventory } from '../../decision-inventory.js';
import { workspaceRoot } from '../../outbox.js';

export const command: GmCommand = {
  name: 'decisions check',
  summary: 'validate the creator decision inventory and its rendered markdown',
  usage: '[--game <slug>]',
  flags: { game: { type: 'string', help: 'game slug (defaults to the current game)' } },
  async run(ctx, _args, flags) {
    const { slug: currentSlug } = inventoryPath(ctx.cwd);
    const slug = typeof flags.game === 'string' && flags.game.trim() ? flags.game.trim() : currentSlug;
    const target = inventoryFile(workspaceRoot(ctx.cwd), slug);
    const inventory = readInventory(target);
    const mdFile = target.replace(/decisions\.json$/, 'decisions.md');
    let markdown = '';
    try {
      markdown = readFileSync(mdFile, 'utf8');
    } catch {
      /* stale/missing is reported below */
    }
    const stale = markdown !== renderInventory(inventory);
    if (ctx.json)
      ctx.out(JSON.stringify({ game: slug, ok: !stale, decisions: inventory.length, markdown: mdFile, stale }));
    else if (stale) ctx.err(`decisions.md is stale; run gm decisions render for ${slug}`);
    else ctx.out(`decisions ok: ${inventory.length} entries for ${slug}`);
    return stale ? EXIT.failed : EXIT.ok;
  },
};
