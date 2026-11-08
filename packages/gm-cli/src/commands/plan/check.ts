import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { checkRoles, describeProblem } from '../../plan/roles.js';
import { rolesFor } from '../../skills/catalog.js';

const HELP = 'gm help plan check';

// `gh issue list --json number,title,labels` writes labels as objects; plain strings are accepted too.
const Tickets = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string().optional(),
    labels: z.array(z.union([z.string(), z.object({ name: z.string() })])),
  }),
);

function readTickets(path: string, cwd: string): z.infer<typeof Tickets> {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(cwd, path), 'utf8'));
  } catch (error) {
    throw new UsageError(
      `cannot read --tickets ${path}: ${error instanceof Error ? error.message : String(error)}`,
      HELP,
    );
  }
  const parsed = Tickets.safeParse(value);
  if (!parsed.success) throw new UsageError(`--tickets ${path} has the wrong shape: ${parsed.error.message}`, HELP);
  return parsed.data;
}

export const command: GmCommand = {
  name: 'plan check',
  summary: 'fail any planned ticket without one game:<slug> label and a known role:* label',
  usage: '--tickets <issues.json> [--game <slug>]',
  example: 'plan check --tickets issues.json --game blobs',
  flags: {
    tickets: { type: 'string', help: 'JSON from gh issue list --json number,title,labels' },
    game: { type: 'string', help: "check only this game's tickets; another game's tickets are skipped" },
  },
  async run(ctx, _args, flags) {
    const path = typeof flags.tickets === 'string' ? flags.tickets.trim() : '';
    if (!path) throw new UsageError('--tickets is required', HELP);
    const game = typeof flags.game === 'string' && flags.game.trim() !== '' ? flags.game.trim() : undefined;
    const tickets = readTickets(path, ctx.cwd).map((ticket) => ({
      number: ticket.number,
      title: ticket.title,
      labels: ticket.labels.map((label) => (typeof label === 'string' ? label : label.name)),
    }));
    const known = rolesFor(ctx.cwd, ctx.skillsDir).map((role) => role.label);
    const report = checkRoles(tickets, known, game);
    if (report.checked === 0) {
      ctx.err(`no tickets to check in ${path}${game ? ` for game:${game}` : ''}`);
      return EXIT.failed;
    }
    if (ctx.json) ctx.out(JSON.stringify(report));
    else if (report.failed.length === 0) ctx.out(`plan ok: ${report.checked} tickets carry a game and a role`);
    else
      for (const { ticket, problems } of report.failed)
        ctx.out(`#${ticket}: ${problems.map(describeProblem).join('; ')}`);
    return report.failed.length === 0 ? EXIT.ok : EXIT.failed;
  },
};
