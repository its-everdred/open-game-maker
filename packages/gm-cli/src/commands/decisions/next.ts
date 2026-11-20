import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { inventoryPath, readInventory, ticketDecisionIds } from '../../decision-inventory.js';

export const command: GmCommand = {
  name: 'decisions next',
  summary: 'list open creator decisions for a ticket as JSON',
  usage: '--ticket <n> [--body <file>]',
  flags: { ticket: { type: 'string', help: 'ticket number' }, body: { type: 'string', help: 'ticket body markdown' } },
  async run(ctx, _args, flags) {
    const ticket = typeof flags.ticket === 'string' ? flags.ticket.trim() : '';
    if (!ticket) throw new UsageError('--ticket is required', 'gm decisions next --ticket <n>');
    const { file } = inventoryPath(ctx.cwd);
    const inventory = readInventory(file);
    let ids: string[] | null = null;
    if (typeof flags.body === 'string') ids = ticketDecisionIds(readFileSync(resolve(ctx.cwd, flags.body), 'utf8'));
    const decisions = inventory.filter(
      (entry) => entry.status === 'open' && (entry.ticket === Number(ticket) || (ids?.includes(entry.id) ?? false)),
    );
    ctx.out(
      JSON.stringify({
        ticket,
        decisions: decisions.map(({ id, area, question, options, recommendation, sources }) => ({
          id,
          area,
          question,
          options,
          recommendation,
          sources,
        })),
      }),
    );
    return EXIT.ok;
  },
};
