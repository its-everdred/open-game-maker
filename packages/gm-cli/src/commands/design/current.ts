import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DesignDocSchema } from '@ogm/contracts';
import { z } from 'zod';

import { CommandError, EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { workspaceRoot } from '../../outbox.js';

const snapshotSchema = z.object({
  rev: z.number().int().nonnegative(),
  buildId: z.string().nullable(),
  doc: DesignDocSchema,
});

async function ticketFor(ctx: GmContext): Promise<string> {
  let ticket = ctx.config.aiurIssue === undefined ? '' : String(ctx.config.aiurIssue);
  if (!ticket) {
    try {
      ticket = (await readFile(join(workspaceRoot(ctx.cwd), '.gm/context/ticket'), 'utf8')).trim();
    } catch {
      throw new CommandError('current ticket identifier is unavailable');
    }
  }
  if (!/^[1-9][0-9]{0,15}$/.test(ticket)) throw new CommandError('current ticket identifier is invalid');
  return ticket;
}

export const command: GmCommand = {
  name: 'design current',
  summary: "read the creator's latest effective design for this job",
  example: 'design current --json',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError('gm design current takes no arguments', 'gm design current --json');
    const ticket = await ticketFor(ctx);
    if (!ctx.blobApi) throw new CommandError('current design service is unavailable');
    try {
      const secret = (await readFile(ctx.blobApi.secretFile, 'utf8')).trim();
      if (!secret) throw new Error('missing credential');
      const response = await fetch(new URL(`/internal/jobs/by-ticket/${ticket}/design`, ctx.blobApi.url), {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error('design request failed');
      const snapshot = snapshotSchema.parse(await response.json());
      ctx.out(JSON.stringify(snapshot));
      return EXIT.ok;
    } catch {
      throw new CommandError('current design service is unavailable or returned invalid data');
    }
  },
};
