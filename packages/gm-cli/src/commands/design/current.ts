import { readFile } from 'node:fs/promises';

import { DesignDocSchema } from '@ogm/contracts';
import { z } from 'zod';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { ticketFor } from '../../ticket.js';

const snapshotSchema = z.object({
  rev: z.number().int().nonnegative(),
  buildId: z.string().nullable(),
  doc: DesignDocSchema,
});

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
