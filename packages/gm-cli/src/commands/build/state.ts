import {
  aiurStatuses,
  gameSlug,
  gameTickets,
  instanceRepo,
  readTicket,
  REPO_FLAG,
  stateLabel,
  ticketNumber,
  type AiurStatus,
  type Ticket,
} from '../../build-control.js';
import { UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';

const USAGE = 'gm build state <ticket> | --game <slug>';

/* Owner and injected skills come from aiur's dispatch record, which aiur does not serve yet (#662): always `-`. */
function row(ticket: Ticket, aiur: AiurStatus | undefined) {
  const paused = ticket.labels.includes('agent:paused') || aiur?.paused === true;
  return {
    ticket: ticket.number,
    title: ticket.title,
    game: ticket.game ?? '-',
    state: stateLabel(ticket),
    status: aiur?.status ?? '-',
    owner: '-',
    pr: ticket.pr ? `#${ticket.pr.number}${ticket.pr.draft ? ' draft' : ''}` : '-',
    prUrl: ticket.pr?.url ?? null,
    ci: ticket.pr?.ci ?? '-',
    paused: paused ? (aiur?.waiting ?? 'paused') : '-',
    skills: '-',
  };
}

export const command: GmCommand = {
  name: 'build state',
  summary: "show a build ticket's aiur state, PR, CI and pause, or one line per ticket of a game",
  usage: '<ticket> | --game <slug> [--repo <owner/repo>] [--json]',
  example: 'build state --game blobs',
  flags: { game: { type: 'string', help: 'every open ticket labelled game:<slug>' }, repo: REPO_FLAG },
  async run(ctx, args, flags) {
    const byGame = flags.game !== undefined;
    if (byGame ? args.length > 0 : args.length !== 1) throw new UsageError('pass one ticket or --game', USAGE);
    const repo = instanceRepo(ctx, flags);
    const tickets = byGame
      ? gameTickets(ctx, repo, gameSlug(flags.game, USAGE))
      : [readTicket(ctx, repo, ticketNumber(args[0], USAGE))];
    const { statuses, problem } = aiurStatuses(ctx);
    if (problem) ctx.err(`aiur status unavailable: ${problem}`);
    const rows = tickets.map((ticket) => row(ticket, statuses?.get(ticket.number)));

    if (ctx.json) {
      if (byGame) printJson(ctx, { game: flags.game, repo, tickets: rows });
      else printJson(ctx, rows[0]!);
    } else if (byGame) {
      if (rows.length === 0) ctx.out(`no open tickets labelled game:${String(flags.game)} in ${repo}`);
      for (const r of rows) {
        const pause = r.paused === '-' ? '' : `  paused: ${r.paused}`;
        ctx.out(`#${r.ticket}  ${r.state}  ${r.status}  PR ${r.pr} ${r.ci}${pause}  ${r.title}`);
      }
    } else {
      const r = rows[0]!;
      ctx.out(`#${r.ticket} ${r.title}`);
      ctx.out(`game: ${r.game}`);
      ctx.out(`state: ${r.state}`);
      ctx.out(`aiur: ${r.status}`);
      ctx.out(`owner: ${r.owner}`);
      ctx.out(`pr: ${r.pr}${r.prUrl ? ` ${r.prUrl}` : ''}`);
      ctx.out(`ci: ${r.ci}`);
      ctx.out(`paused: ${r.paused}`);
      ctx.out(`skills: ${r.skills}`);
    }
    return 0;
  },
};
