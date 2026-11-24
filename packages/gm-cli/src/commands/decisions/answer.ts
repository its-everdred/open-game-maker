import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { inventoryPath, readInventory, writeInventory } from '../../decision-inventory.js';

export const command: GmCommand = {
  name: 'decisions answer',
  summary: 'record an inventory decision answer',
  usage: '<id> <option label> [--note <text>] [--reuse <path>]... [--generator <path>] [--reuse-note <text>]',
  flags: {
    note: { type: 'string', help: 'optional creator note from the answer comment' },
    reuse: { type: 'string', multiple: true, help: 'a file or folder the approved round left to build on (repeat)' },
    generator: { type: 'string', help: 'with --reuse, the script that made those files' },
    'reuse-note': { type: 'string', help: 'with --reuse, how to reuse or extend them' },
  },
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
    const paths = Array.isArray(flags.reuse)
      ? (flags.reuse as string[]).map((path) => path.trim()).filter(Boolean)
      : [];
    const generator = typeof flags.generator === 'string' ? flags.generator.trim() : '';
    const reuseNote = typeof flags['reuse-note'] === 'string' ? flags['reuse-note'].trim() : '';
    if (paths.length === 0 && (generator || reuseNote))
      throw new UsageError('--generator and --reuse-note describe --reuse paths', 'add --reuse <path>');
    if (paths.length > 0)
      entry.reuse = { paths, ...(generator ? { generator } : {}), ...(reuseNote ? { notes: reuseNote } : {}) };
    writeInventory(file, inventory);
    ctx.out(`answered ${entry.id}: ${entry.answer}`);
    return EXIT.ok;
  },
};
