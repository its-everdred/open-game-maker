import { DecisionKey, waitLabel, waitMarker } from '@ogm/contracts';

import {
  aiur,
  gh,
  instanceRepo,
  readTicket,
  REPO_FLAG,
  stateLabel,
  ticketAction,
  ticketNumber,
} from '../../build-control.js';
import { UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';

const USAGE = 'gm build park <ticket> [--on <decision-id|key> [--when <option>]]';

const plain = ticketAction({
  verb: 'park',
  summary: "free a paused build ticket's agent slot until it is resumed (aiur park)",
  aiurArgs: (n) => ['park', String(n)],
});

/*
 * `--on` records that the ticket waits on a creator decision (#680): gm labels it `waits:<key>` and comments the wait,
 * and the API releases it (answer written in, resumed, queued) once that decision is answered, with no Executor step.
 * A closed ticket, or one aiur has not queued, is follow-up work the answer starts: it is only labelled, and `--when`
 * names the option that starts it (any other answer closes it as not planned).
 */
export const command: GmCommand = {
  ...plain,
  summary: "free a paused build ticket's agent slot until it is resumed, or until a decision is answered (--on)",
  usage: '<ticket> [--on <decision-id|key> [--when <option>]] [--repo <owner/repo>] [--json]',
  example: 'build park 211 --on blobs/diorama',
  flags: {
    repo: REPO_FLAG,
    on: { type: 'string', help: 'the aiur decision id or decision key (gm decide --key) the ticket waits on' },
    when: { type: 'string', help: 'start the ticket only when the answer picks this option' },
  },
  async run(ctx, args, flags) {
    if (flags.on === undefined) {
      if (flags.when !== undefined) throw new UsageError('--when needs --on', USAGE);
      return plain.run(ctx, args, flags);
    }
    if (args.length !== 1) throw new UsageError('gm build park takes one ticket', USAGE);
    const key = DecisionKey.safeParse(flags.on);
    if (!key.success) {
      throw new UsageError(`not a decision id or key: ${String(flags.on)}`, 'use [a-z0-9_/-], at most 40 characters');
    }
    const when = flags.when === undefined ? undefined : String(flags.when);
    if (when !== undefined && !/^[a-z0-9_-]{1,32}$/.test(when))
      throw new UsageError(`not an option id: ${when}`, USAGE);
    const repo = instanceRepo(ctx, flags);
    const ticket = readTicket(ctx, repo, ticketNumber(args[0], USAGE));
    if (!ticket.game) {
      throw new UsageError(`#${ticket.number} has no game: label, so it is not a build ticket`, 'label it game:<slug>');
    }

    const label = waitLabel(key.data);
    const n = String(ticket.number);
    gh(ctx, [
      'label',
      'create',
      label,
      '-R',
      repo,
      '--force',
      '--color',
      'c5def5',
      '--description',
      'waits on a decision',
    ]);
    const condition = when === undefined ? '' : ` Starts only if the answer picks \`${when}\`.`;
    gh(ctx, [
      'issue',
      'comment',
      n,
      '-R',
      repo,
      '--body',
      `Waits on decision \`${key.data}\`.${condition}\n${waitMarker({ key: key.data, ...(when === undefined ? {} : { when }) })}`,
    ]);
    gh(ctx, ['issue', 'edit', n, '-R', repo, '--add-label', label]);

    // A ticket aiur holds is parked as before; follow-up work (closed, or never queued) has no agent to park.
    const held = ticket.open && stateLabel(ticket) !== '-';
    const said = held ? aiur(ctx, ['park', n]) : '';
    if (ctx.json)
      printJson(ctx, { ok: true, ticket: ticket.number, game: ticket.game, waits_on: key.data, when, aiur: said });
    else ctx.out(`${said ? `${said}\n` : ''}#${ticket.number} waits on ${key.data}${when ? ` (${when})` : ''}`);
    return 0;
  },
};
