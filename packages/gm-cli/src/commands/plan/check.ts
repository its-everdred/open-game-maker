import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { checkRoles, describeProblem } from '../../plan/roles.js';
import { rolesFor } from '../../skills/catalog.js';
import { DecisionInventory, duplicateDecisionQuestions } from '@ogm/contracts';
import { inventoryFile, ticketDecisionIds } from '../../decision-inventory.js';
import { workspaceRoot } from '../../outbox.js';

const HELP = 'gm help plan check';

// `gh issue list --json number,title,labels` writes labels as objects; plain strings are accepted too.
const Tickets = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string().optional(),
    labels: z.array(z.union([z.string(), z.object({ name: z.string() })])),
    body: z.string().optional(),
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
  usage: '--tickets <issues.json> [--game <slug>] [--first-playable] [--max-tickets <count>]',
  example: 'plan check --tickets issues.json --game blobs',
  flags: {
    tickets: { type: 'string', help: 'JSON from gh issue list --json number,title,labels,body' },
    game: { type: 'string', help: "check only this game's tickets; another game's tickets are skipped" },
    'first-playable': { type: 'boolean', help: 'allow later decisions to remain unassigned in a bounded plan' },
    'max-tickets': { type: 'number', help: 'maximum game children, excluding the parent and planner' },
  },
  async run(ctx, _args, flags) {
    const path = typeof flags.tickets === 'string' ? flags.tickets.trim() : '';
    if (!path) throw new UsageError('--tickets is required', HELP);
    const game = typeof flags.game === 'string' && flags.game.trim() !== '' ? flags.game.trim() : undefined;
    const limit = flags['max-tickets'];
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || !game))
      throw new UsageError('--max-tickets needs a positive integer and --game', HELP);
    const tickets = readTickets(path, ctx.cwd).map((ticket) => ({
      number: ticket.number,
      title: ticket.title,
      body: ticket.body,
      labels: ticket.labels.map((label) => (typeof label === 'string' ? label : label.name)),
    }));
    const known = rolesFor(ctx.cwd, ctx.skillsDir).map((role) => role.label);
    const report = checkRoles(tickets, known, game);
    const childCount = game
      ? tickets.filter(
          (ticket) =>
            ticket.labels.includes(`game:${game}`) &&
            !ticket.labels.includes('request:new-game') &&
            !ticket.body?.includes('gm-ticket:new-game-plan '),
        ).length
      : 0;
    const limitProblem =
      typeof limit === 'number' && childCount > limit
        ? `game ${game} has ${childCount} child tickets; maximum is ${limit}`
        : null;
    const inventoryProblems: string[] = [];
    if (game) {
      const targetInventory = inventoryFile(workspaceRoot(ctx.cwd), game);
      let inventory: z.infer<typeof DecisionInventory> | null = null;
      try {
        const parsed = DecisionInventory.safeParse(JSON.parse(readFileSync(targetInventory, 'utf8')) as unknown);
        if (!parsed.success) inventoryProblems.push(`docs/${game}/decisions.json is invalid: ${parsed.error.message}`);
        else inventory = parsed.data;
      } catch {
        inventoryProblems.push(`game ${game} has no valid docs/${game}/decisions.json`);
      }
      if (inventory) {
        if (flags['first-playable'])
          for (const { first, second } of duplicateDecisionQuestions(inventory))
            inventoryProblems.push(`decisions ${first} and ${second} ask the same question in the same area`);
        const listed = new Set<string>();
        for (const ticket of tickets.filter((item) => item.labels.some((label) => label === `game:${game}`))) {
          if (!ticket.body) {
            inventoryProblems.push(`#${ticket.number} body missing; use gh issue list --json number,title,labels,body`);
            continue;
          }
          const ids = ticketDecisionIds(ticket.body);
          if (ids === null) inventoryProblems.push(`#${ticket.number} has no ## Creator decisions section`);
          else
            for (const id of ids) {
              listed.add(id);
              const entry = inventory.find((candidate) => candidate.id === id);
              if (!entry) inventoryProblems.push(`#${ticket.number} lists unknown decision ${id}`);
              else if (entry.ticket !== null && entry.ticket !== ticket.number)
                inventoryProblems.push(
                  `decision ${id} is assigned to ticket #${entry.ticket} but listed on #${ticket.number}`,
                );
            }
        }
        for (const decision of inventory)
          if ((!flags['first-playable'] || decision.ticket !== null) && !listed.has(decision.id))
            inventoryProblems.push(`decision ${decision.id} is not listed on a game:${game} ticket`);
      }
    }
    if (report.checked === 0) {
      ctx.err(`no tickets to check in ${path}${game ? ` for game:${game}` : ''}`);
      return EXIT.failed;
    }
    if (ctx.json)
      ctx.out(
        JSON.stringify({
          ...report,
          inventoryProblems,
          ...(limitProblem ? { limitProblem } : {}),
          ok: report.failed.length === 0 && inventoryProblems.length === 0 && !limitProblem,
        }),
      );
    else if (report.failed.length === 0 && inventoryProblems.length === 0 && !limitProblem)
      ctx.out(`plan ok: ${report.checked} tickets carry a game and a role`);
    else
      for (const { ticket, problems } of report.failed)
        ctx.out(`#${ticket}: ${problems.map(describeProblem).join('; ')}`);
    if (!ctx.json) inventoryProblems.forEach((problem) => ctx.err(problem));
    if (!ctx.json && limitProblem) ctx.err(limitProblem);
    return report.failed.length === 0 && inventoryProblems.length === 0 && !limitProblem ? EXIT.ok : EXIT.failed;
  },
};
