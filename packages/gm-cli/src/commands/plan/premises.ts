import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DesignDecision } from '@ogm/contracts';
import { z } from 'zod';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { readLedger } from '../../ledger/index.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { sweepPremises, type ChangedSince } from '../../plan/premises.js';

const HELP = 'gm help plan premises';

// `gh issue list --json number,title,body,state` writes exactly this shape; extra fields are ignored.
const Tickets = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string().optional(),
    body: z.string(),
    state: z.string().optional(),
  }),
);
// The internal history route's page (`{decisions: [...]}`) or its bare list.
const Decisions = z.union([z.object({ decisions: z.array(DesignDecision) }), z.array(DesignDecision)]);

function readJson<T>(flags: Record<string, unknown>, flag: string, cwd: string, schema: z.ZodType<T>): T {
  const path = typeof flags[flag] === 'string' ? flags[flag].trim() : '';
  if (!path) throw new UsageError(`--${flag} is required`, HELP);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(cwd, path), 'utf8'));
  } catch (error) {
    throw new UsageError(
      `cannot read --${flag} ${path}: ${error instanceof Error ? error.message : String(error)}`,
      HELP,
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new UsageError(`--${flag} ${path} has the wrong shape: ${parsed.error.message}`, HELP);
  return parsed.data;
}

function gitChangedSince(root: string): ChangedSince {
  return (sha, paths) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, stdio: 'ignore' });
    } catch {
      return null;
    }
    const out = execFileSync('git', ['diff', '--name-only', sha, 'HEAD', '--', ...paths], {
      cwd: root,
      encoding: 'utf8',
    });
    return out.split('\n').filter((line) => line.length > 0);
  };
}

export const command: GmCommand = {
  name: 'plan premises',
  summary: 'flag open tickets whose cited decisions moved or whose spec or owned files changed since context-sha',
  usage: '--tickets <issues.json> --decisions <decisions.json>',
  example: 'plan premises --tickets issues.json --decisions decisions.json',
  flags: {
    tickets: { type: 'string', help: 'JSON from gh issue list --json number,title,body,state' },
    decisions: { type: 'string', help: 'JSON from GET /internal/games/<id>/design-decisions' },
  },
  async run(ctx, _args, flags) {
    const tickets = readJson(flags, 'tickets', ctx.cwd, Tickets);
    const page = readJson(flags, 'decisions', ctx.cwd, Decisions);
    const root = workspaceRoot(ctx.cwd);
    const report = sweepPremises({
      tickets,
      decisions: Array.isArray(page) ? page : page.decisions,
      ledger: readLedger(gameDir(ctx.cwd, root)),
      changedSince: gitChangedSince(root),
    });
    ctx.out(JSON.stringify(report));
    return report.flagged.length === 0 ? EXIT.ok : EXIT.failed;
  },
};
