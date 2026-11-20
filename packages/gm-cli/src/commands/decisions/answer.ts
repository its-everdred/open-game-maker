import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { inventoryPath, readInventory, writeInventory } from '../../decision-inventory.js';

export const command: GmCommand = {
  name: 'decisions answer',
  summary: 'record an inventory decision answer',
  usage: '<id> <option label> [--note <text>]',
  flags: { note: { type: 'string', help: 'optional creator note from the answer comment' } },
  async run(ctx, args, flags) {
    if (args.length !== 2)
      throw new UsageError('provide a decision id and answer label', 'gm decisions answer <id> <option>');
    const { file } = inventoryPath(ctx.cwd);
    const inventory = readInventory(file);
    const entry = inventory.find((decision) => decision.id === args[0]);
    if (!entry) throw new UsageError(`unknown decision ${args[0]}`, 'use an id from docs/<slug>/decisions.json');
    if (entry.status !== 'asked' && entry.status !== 'defaulted')
      throw new UsageError(`decision ${entry.id} has not been asked`, 'raise it with gm decisions raise first');
    if (!entry.options.some((option) => option.label === args[1]))
      throw new UsageError(`unknown option ${args[1]} for ${args[0]}`, 'use one of the decision option labels');
    entry.status = 'answered';
    const note = typeof flags.note === 'string' ? flags.note.trim() : '';
    entry.answer = note ? `${args[1]}: ${note}` : args[1];
    entry.answered_at = new Date().toISOString();
    writeInventory(file, inventory);
    ctx.out(`answered ${entry.id}: ${entry.answer}`);
    return EXIT.ok;
  },
};
