import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { CommandError, UsageError, type FlagSpec, type GmCommand, type GmContext } from './command.js';
import { printJson } from './context.js';
import { readEnvFile } from './commands/publish/index.js';

/*
 * `gm build pause|resume|park|requeue|state|hold-pr` (#662): Game Maker's handle on aiur's own controls for the build
 * tickets in the instance repository. Every action is one `aiur` call; GM adds the game (from the ticket's `game:`
 * label) and never writes an aiur lifecycle label itself.
 */

const OUTPUT_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

export type Ticket = {
  number: number;
  title: string;
  open: boolean;
  labels: string[];
  game: string | null;
  pr: { number: number; url: string; draft: boolean; ci: string | null } | null;
};

function exec(ctx: GmContext, cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, {
    cwd: ctx.cwd,
    env: { ...ctx.env, GH_PROMPT_DISABLED: '1' },
    encoding: 'utf8',
    maxBuffer: OUTPUT_BYTES,
    timeout: TIMEOUT_MS,
  });
  const err = `${result.stderr ?? ''}${result.error ? result.error.message : ''}`.trim();
  return { ok: result.status === 0, out: result.stdout ?? '', err, status: result.status };
}

/** `owner/repo` of the instance repository: `--repo`, else `OGM_INSTANCE_REPO` from the environment or api.env. */
export function instanceRepo(ctx: GmContext, flags: Record<string, unknown>): string {
  const envDir = ctx.env?.OGM_ENV_DIR || join(ctx.home ?? homedir(), '.config', 'ogm', 'env');
  const repo =
    (typeof flags.repo === 'string' && flags.repo) ||
    ctx.env?.OGM_INSTANCE_REPO ||
    readEnvFile(join(envDir, 'api.env')).OGM_INSTANCE_REPO ||
    '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new UsageError('no instance repository', 'pass --repo <owner/repo> or set OGM_INSTANCE_REPO in api.env');
  }
  return repo;
}

/** A ticket number from `12` or `#12`. */
export function ticketNumber(arg: string | undefined, usage: string): number {
  const match = /^#?(\d+)$/.exec(arg ?? '');
  if (!match) throw new UsageError(arg === undefined ? 'no ticket' : `not a ticket number: ${arg}`, usage);
  return Number(match[1]);
}

export function gameSlug(value: unknown, usage: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new UsageError(`not a game slug: ${String(value)}`, usage);
  }
  return value;
}

const ISSUE_FIELDS = `number title state labels(first: 50) { nodes { name } }
  closedByPullRequestsReferences(first: 5, includeClosedPrs: false) {
    nodes { number url isDraft state commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
  }`;

type IssueNode = {
  number: number;
  title: string;
  state: string;
  labels: { nodes: { name: string }[] };
  closedByPullRequestsReferences: {
    nodes: {
      number: number;
      url: string;
      isDraft: boolean;
      state: string;
      commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
    }[];
  };
};

function graphql(ctx: GmContext, repo: string, query: string, vars: Record<string, string | number>): unknown {
  const [owner, name] = repo.split('/') as [string, string];
  const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`];
  for (const [key, value] of Object.entries(vars)) {
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
  }
  const result = exec(ctx, 'gh', args);
  if (!result.ok) throw new CommandError(`gh could not read ${repo}: ${result.err.split('\n')[0] || 'no output'}`);
  try {
    return (JSON.parse(result.out) as { data: unknown }).data;
  } catch {
    throw new CommandError(`gh answered with something other than JSON for ${repo}`);
  }
}

function toTicket(node: IssueNode): Ticket {
  const labels = node.labels.nodes.map(({ name }) => name);
  const game = labels.find((label) => label.startsWith('game:'))?.slice('game:'.length) ?? null;
  const pr = node.closedByPullRequestsReferences.nodes.find(({ state }) => state === 'OPEN') ?? null;
  return {
    number: node.number,
    title: node.title,
    open: node.state === 'OPEN',
    labels,
    game,
    pr: pr && {
      number: pr.number,
      url: pr.url,
      draft: pr.isDraft,
      ci: pr.commits.nodes[0]?.commit.statusCheckRollup?.state.toLowerCase() ?? null,
    },
  };
}

export function readTicket(ctx: GmContext, repo: string, number: number): Ticket {
  const query = `query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) { issue(number: $number) { ${ISSUE_FIELDS} } } }`;
  const data = graphql(ctx, repo, query, { number }) as { repository: { issue: IssueNode | null } | null } | null;
  const issue = data?.repository?.issue;
  if (!issue) throw new UsageError(`${repo} has no issue #${number}`, `gm build state --game <slug> --repo ${repo}`);
  return toTicket(issue);
}

/** Every open ticket labelled `game:<slug>`, oldest first. */
export function gameTickets(ctx: GmContext, repo: string, slug: string): Ticket[] {
  const query = `query($owner: String!, $name: String!, $label: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      issues(labels: [$label], states: OPEN, first: 100, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
        pageInfo { hasNextPage endCursor } nodes { ${ISSUE_FIELDS} } } } }`;
  const tickets: Ticket[] = [];
  let after: string | null = null;
  do {
    type Page = {
      repository: {
        issues: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: IssueNode[] };
      } | null;
    };
    const data = graphql(ctx, repo, query, { label: `game:${slug}`, ...(after ? { after } : {}) }) as Page;
    const issues = data.repository?.issues;
    if (!issues) throw new CommandError(`gh found no repository ${repo}`);
    tickets.push(...issues.nodes.map(toTicket));
    after = issues.pageInfo.hasNextPage ? issues.pageInfo.endCursor : null;
  } while (after);
  return tickets;
}

/** aiur puts its reason first; a usage block may follow it. */
function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? '';
}

/** Runs `aiur <args>`, echoing its output; a refusal or a stopped daemon fails the command with aiur's own words. */
export function aiur(ctx: GmContext, args: string[]): string {
  const result = exec(ctx, 'aiur', args);
  const said = `${result.out}${result.err ? `\n${result.err}` : ''}`.trim();
  if (!result.ok) {
    const why = firstLine(result.err || result.out) || `exit ${result.status ?? 'unknown'}`;
    throw new CommandError(`aiur ${args.join(' ')} failed: ${why}`);
  }
  return said;
}

/** Runs `gh <args>`; a failure fails the command with gh's first line. */
export function gh(ctx: GmContext, args: string[]): string {
  const result = exec(ctx, 'gh', args);
  if (!result.ok)
    throw new CommandError(`gh ${args[0]} ${args[1] ?? ''} failed: ${firstLine(result.err || result.out)}`);
  return result.out;
}

/** The ticket's state label without the `agent:` prefix; `-` when it has none. */
export function stateLabel(ticket: Ticket): string {
  const states = ticket.labels.filter((label) => /^agent:[a-z-]+$/.test(label) && label !== 'agent:paused');
  return states.map((label) => label.slice('agent:'.length)).join(',') || '-';
}

/** A per-ticket action: the ticket must be a build ticket (one `game:` label), then one aiur call. */
export function ticketAction(spec: { verb: string; summary: string; aiurArgs: (n: number) => string[] }): GmCommand {
  const usage = `gm build ${spec.verb} <ticket>`;
  return {
    name: `build ${spec.verb}`,
    summary: spec.summary,
    usage: '<ticket> [--repo <owner/repo>] [--json]',
    example: `build ${spec.verb} 212`,
    flags: { repo: REPO_FLAG },
    async run(ctx, args, flags) {
      if (args.length !== 1) throw new UsageError(`gm build ${spec.verb} takes one ticket`, usage);
      const repo = instanceRepo(ctx, flags);
      const ticket = readTicket(ctx, repo, ticketNumber(args[0], usage));
      if (!ticket.game) {
        throw new UsageError(
          `#${ticket.number} has no game: label, so it is not a build ticket`,
          'label it game:<slug>',
        );
      }
      const said = aiur(ctx, spec.aiurArgs(ticket.number));
      if (ctx.json) printJson(ctx, { ok: true, ticket: ticket.number, game: ticket.game, aiur: said });
      else ctx.out(said || `${spec.verb} #${ticket.number} (${ticket.game})`);
      return 0;
    },
  };
}

/** `pause|resume` for one ticket, or with `--game <slug>` for every open ticket of that game (never `--all`). */
export function pauseOrResume(verb: 'pause' | 'resume', summary: string): GmCommand {
  const single = ticketAction({ verb, summary, aiurArgs: (n) => [verb, String(n)] });
  return {
    ...single,
    usage: '<ticket> | --game <slug> [--repo <owner/repo>] [--json]',
    flags: { ...GAME_FLAG, repo: REPO_FLAG },
    async run(ctx, args, flags) {
      if (flags.game === undefined) return single.run(ctx, args, flags);
      const usage = `gm build ${verb} --game <slug>`;
      if (args.length > 0) throw new UsageError(`pass a ticket or --game, not both`, usage);
      const slug = gameSlug(flags.game, usage);
      const repo = instanceRepo(ctx, flags);
      const numbers = gameTickets(ctx, repo, slug).map(({ number }) => number);
      if (numbers.length === 0) {
        if (ctx.json) printJson(ctx, { ok: true, game: slug, tickets: [], aiur: '' });
        else ctx.out(`no open tickets labelled game:${slug} in ${repo}`);
        return 0;
      }
      const said = aiur(ctx, [verb, ...numbers.map(String)]);
      if (ctx.json) printJson(ctx, { ok: true, game: slug, tickets: numbers, aiur: said });
      else ctx.out(said || `${verb} ${numbers.map((n) => `#${n}`).join(' ')} (${slug})`);
      return 0;
    },
  };
}

export const REPO_FLAG: FlagSpec[string] = {
  type: 'string',
  help: 'instance repository owner/repo (default OGM_INSTANCE_REPO)',
};
export const GAME_FLAG: FlagSpec = { game: { type: 'string', help: 'every open ticket labelled game:<slug>' } };

export type AiurStatus = { status: string; waiting: string | null; paused: boolean };

/**
 * Each ticket's status from `aiur units --scope all --json`, keyed by ticket number. Null when aiur cannot answer (no
 * daemon, or an aiur without `units`); the caller shows `-` and says why once.
 */
export function aiurStatuses(ctx: GmContext): { statuses: Map<number, AiurStatus> | null; problem: string | null } {
  const result = exec(ctx, 'aiur', ['units', '--scope', 'all', '--json']);
  if (!result.ok) {
    return { statuses: null, problem: firstLine(result.err || result.out) || 'aiur units failed' };
  }
  type Row = {
    identity?: { identifier?: string };
    runtime?: { work_state?: string; waiting_reason?: string; 'tracker_paused?'?: boolean };
  };
  let rows: Row[];
  try {
    rows = (JSON.parse(result.out) as { data?: { view?: { rows?: Row[] | null } } }).data?.view?.rows ?? [];
  } catch {
    return { statuses: null, problem: 'aiur units --json did not answer JSON' };
  }
  const statuses = new Map<number, AiurStatus>();
  for (const row of rows) {
    const id = Number(row.identity?.identifier);
    if (!Number.isInteger(id)) continue;
    const status = row.runtime?.work_state ?? '-';
    statuses.set(id, {
      status,
      waiting: row.runtime?.waiting_reason ?? null,
      paused: row.runtime?.['tracker_paused?'] === true || /paus/.test(status),
    });
  }
  return { statuses, problem: null };
}
