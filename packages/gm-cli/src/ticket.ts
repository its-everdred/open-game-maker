import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CommandError, type GmContext } from './command.js';
import { workspaceRoot } from './outbox.js';

/** The Aiur ticket this workspace works, from the hook environment or `.gm/context/ticket`. */
export async function ticketFor(ctx: GmContext): Promise<string> {
  let ticket = ctx.config.aiurIssue === undefined ? '' : String(ctx.config.aiurIssue);
  if (!ticket) {
    try {
      ticket = (await readFile(join(workspaceRoot(ctx.cwd), '.gm/context/ticket'), 'utf8')).trim();
    } catch {
      throw new CommandError('current ticket identifier is unavailable (run inside an Aiur ticket workspace)');
    }
  }
  if (!/^[1-9][0-9]{0,15}$/.test(ticket)) throw new CommandError('current ticket identifier is invalid');
  return ticket;
}
