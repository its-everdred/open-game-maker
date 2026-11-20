import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EXIT, type GmCommand } from '../../command.js';
import { inventoryPath, readInventory, renderInventory } from '../../decision-inventory.js';

export const command: GmCommand = {
  name: 'decisions render',
  summary: 'render decisions.md grouped by area from the inventory',
  usage: '',
  flags: {},
  async run(ctx, args) {
    if (args.length) return EXIT.usage;
    const { file } = inventoryPath(ctx.cwd);
    const markdown = renderInventory(readInventory(file));
    const target = file.replace(/decisions\.json$/, 'decisions.md');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, markdown);
    ctx.out(`rendered ${target}`);
    return EXIT.ok;
  },
};
