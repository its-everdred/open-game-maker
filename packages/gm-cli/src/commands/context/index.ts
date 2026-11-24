import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { CommandError, EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { printJson } from '../../context.js';
import { workspaceRoot } from '../../outbox.js';
import {
  belongsTo,
  candidates,
  injectBlock,
  rank,
  renderRelated,
  verdicts,
  type Comment,
  type Decision,
  type History,
  type Issue,
  type Pull,
  type Screen,
} from '../../related-work.js';
import { ticketFor } from '../../ticket.js';

const OUTPUT_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
/** Siblings whose timelines are read for creator verdicts and merged PRs. */
const HISTORY_READS = 6;
/** Merged PRs per ticket whose files are read (the block shows the latest three). */
const PULL_READS = 3;
const GENERATOR = /\.(py|mjs|cjs|js|ts|sh)$/;
const ISSUE = '{number, title, body: (.body // ""), labels: [.labels[].name], repo: .repository_url} | tojson';
const TIMELINE =
  '.[] | if .event == "commented" then {comment: {body: (.body // ""), createdAt: .created_at, association: .author_association}} ' +
  'elif .event == "cross-referenced" and .source.issue.pull_request.merged_at != null then ' +
  '{pull: {number: .source.issue.number, title: .source.issue.title, body: (.source.issue.body // ""), repo: .source.issue.repository_url}} ' +
  'else empty end | tojson';

/**
 * One budgeted REST read through `gh api --paginate` (aiur's guarded gh refuses multi-page `gh issue list`); `jq`
 * turns each item into one JSON line.
 */
async function api<T>(ctx: GmContext, path: string, jq: string): Promise<T[]> {
  const route = path.split('?')[0];
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)('gh', ['api', '--paginate', path, '--jq', jq], {
      cwd: ctx.cwd,
      env: { ...ctx.env, GH_PROMPT_DISABLED: '1' },
      encoding: 'utf8',
      maxBuffer: OUTPUT_BYTES,
      timeout: TIMEOUT_MS,
    }));
  } catch (error) {
    const failed = error as { stderr?: string; killed?: boolean; code?: unknown };
    const err = failed.killed
      ? `timed out after ${TIMEOUT_MS / 1000} s`
      : failed.stderr?.trim() || `exit ${String(failed.code)}`;
    throw new CommandError(`gh api ${route} failed: ${err.split('\n')[0]}`);
  }
  try {
    return stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as T);
  } catch {
    throw new CommandError(`gh api ${route} answered with something other than JSON lines`);
  }
}

type RawIssue = Issue & { repo: string };
type TimelineItem = { comment?: Comment; pull?: Omit<Pull, 'files'> & { repo: string } };

/** A ticket's creator verdicts and the merged PRs of this repository that belong to it, with their files. */
async function history(ctx: GmContext, ticket: number, repo: string): Promise<History> {
  const items = await api<TimelineItem>(ctx, `repos/{owner}/{repo}/issues/${ticket}/timeline?per_page=100`, TIMELINE);
  const linked = new Map<number, Omit<Pull, 'files'>>();
  for (const { pull } of items)
    if (pull && pull.repo === repo && !linked.has(pull.number) && belongsTo(pull.body, ticket))
      linked.set(pull.number, { number: pull.number, title: pull.title, body: pull.body });
  const latest = [...linked.values()].sort((a, b) => b.number - a.number).slice(0, PULL_READS);
  const pulls = await Promise.all(
    latest.map(async (pull) => ({
      ...pull,
      /* A PR whose files cannot be read is still listed: its ticket's verdicts matter more than its file list. */
      files: await api<string>(
        ctx,
        `repos/{owner}/{repo}/pulls/${pull.number}/files?per_page=100`,
        '.[].filename | tojson',
      ).catch((error: unknown) => {
        ctx.err(
          `gm context: no files for PR #${pull.number}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }),
    })),
  );
  return { verdicts: verdicts(items.flatMap(({ comment }) => (comment ? [comment] : []))), pulls };
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new CommandError(`cannot read ${file}`);
  }
}

function readDecisions(file: string): Decision[] {
  const value = readJson(file);
  if (value === null) return [];
  if (!Array.isArray(value)) throw new CommandError(`${file} is not an array`);
  return value.filter((entry): entry is Decision => typeof entry?.id === 'string');
}

function readScreens(file: string): Screen[] {
  const value = readJson(file) as {
    screens?: Record<string, { target?: unknown; phase?: unknown; note?: unknown }>;
  } | null;
  return Object.entries(value?.screens ?? {})
    .filter(([, screen]) => typeof screen.target === 'string')
    .map(([name, screen]) => ({
      name,
      target: screen.target as string,
      ...(typeof screen.phase === 'string' ? { phase: screen.phase } : {}),
      ...(typeof screen.note === 'string' ? { note: screen.note } : {}),
    }));
}

/** Script files up to three folders deep: the generators a round left behind. */
function generators(dir: string, root: string, depth = 0): string[] {
  if (depth > 3) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...generators(path, root, depth + 1));
    else if (GENERATOR.test(entry.name)) out.push(relative(root, path));
  }
  return out;
}

/** A ticket's review folders (`<N>` and `<N>-<round>`) in the game and in the shared library, with their generators. */
function folders(root: string, reviewRoots: string[], ticket: number): { media: string[]; generators: string[] } {
  const media: string[] = [];
  const scripts: string[] = [];
  for (const reviewRoot of reviewRoots) {
    if (!existsSync(reviewRoot)) continue;
    for (const name of readdirSync(reviewRoot).sort()) {
      if (name !== String(ticket) && !name.startsWith(`${ticket}-`)) continue;
      const dir = join(reviewRoot, name);
      if (!statSync(dir).isDirectory()) continue;
      media.push(`${relative(root, dir)}/`);
      scripts.push(...generators(dir, root));
    }
  }
  return { media, generators: scripts.slice(0, 5) };
}

export const command: GmCommand = {
  name: 'context',
  summary: 'list the approved work in the same game that a ticket should build on',
  usage: '[ticket] [--inject <skills dir>]',
  example: 'gm context 41',
  flags: {
    inject: {
      type: 'string',
      help: 'write the block into <dir>/gm-core/SKILL.md (a before_run hook), so the first prompt carries it',
    },
  },
  async run(ctx, args, flags) {
    if (args.length > 1) throw new UsageError('provide at most one ticket number', 'gm context 41');
    const ticket = args[0] ?? (await ticketFor(ctx));
    if (!/^[1-9]\d{0,15}$/.test(ticket)) throw new UsageError(`not a ticket number: ${ticket}`, 'gm context 41');
    const root = workspaceRoot(ctx.cwd);
    const skill = typeof flags.inject === 'string' ? resolve(ctx.cwd, flags.inject, 'gm-core', 'SKILL.md') : null;
    if (skill !== null && !existsSync(skill)) throw new CommandError(`no gm-core skill at ${skill}`);
    /* Until this run finishes, the block says so: a failed or timed-out refresh never leaves an earlier list standing. */
    const write = (block: string[]) => skill && writeFileSync(skill, injectBlock(readFileSync(skill, 'utf8'), block));
    write([
      '## Build on this approved work',
      '',
      `\`gm context ${ticket}\` did not finish. Run it yourself before making a new asset, UI kit, biome or system.`,
    ]);
    try {
      return await collect(ctx, ticket, root, skill, write);
    } catch (error) {
      if (error instanceof UsageError) write([]);
      throw error;
    }
  },
};

async function collect(
  ctx: GmContext,
  ticket: string,
  root: string,
  skill: string | null,
  write: (block: string[]) => unknown,
): Promise<number> {
  const [target] = await api<RawIssue>(ctx, `repos/{owner}/{repo}/issues/${ticket}`, ISSUE);
  if (!target) throw new CommandError(`gh api found no issue #${ticket}`);
  const slug = target.labels.find((label) => label.startsWith('game:'))?.slice('game:'.length);
  if (!slug) throw new UsageError(`#${ticket} has no game:<slug> label`, 'run gm context on a game ticket');
  const siblings = await api<Issue>(
    ctx,
    `repos/{owner}/{repo}/issues?labels=${encodeURIComponent(`game:${slug}`)}&state=all&per_page=100`,
    `.[] | select(.pull_request == null) | ${ISSUE}`,
  );
  const ranked = candidates(target, siblings);
  const numbers = [target.number, ...ranked.slice(0, HISTORY_READS).map((c) => c.issue.number)];
  /* A sibling whose timeline cannot be read is left out; only the target and the sibling list are required. */
  const histories = await Promise.all(
    numbers.map((number) =>
      number === target.number
        ? history(ctx, number, target.repo)
        : history(ctx, number, target.repo).catch((error: unknown) => {
            ctx.err(`gm context: skipped #${number}: ${error instanceof Error ? error.message : String(error)}`);
            return { verdicts: [], pulls: [] };
          }),
    ),
  );
  const read = new Map(numbers.map((number, index) => [number, histories[index]!] as const));

  const gameRoot = existsSync(join(root, 'games', slug)) ? join(root, 'games', slug) : root;
  const items = rank({
    target,
    candidates: ranked,
    history: read,
    decisions: readDecisions(join(root, 'docs', slug, 'decisions.json')),
    screens: readScreens(join(gameRoot, 'review', 'decisions.json')),
    folders: (number) =>
      folders(
        root,
        [join(gameRoot, 'review'), join(root, 'review'), join(root, 'assets-local', 'review', slug)],
        number,
      ),
    gamePrefix: gameRoot === root ? '' : `${relative(root, gameRoot)}/`,
    limit: ctx.limit,
  });

  if (skill !== null) {
    write(renderRelated(target.number, items));
    ctx.out(`gm context: ${items.length} related item(s) for #${ticket} written to ${relative(ctx.cwd, skill)}`);
    return EXIT.ok;
  }
  if (ctx.json) {
    for (const item of items) printJson(ctx, item);
    return EXIT.ok;
  }
  const block = renderRelated(target.number, items);
  if (block.length === 0) ctx.out(`no approved work in game:${slug} relates to #${ticket}`);
  block.forEach((line) => ctx.out(line));
  return EXIT.ok;
}
