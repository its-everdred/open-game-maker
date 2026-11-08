import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { STILL } from '../shot/index.js';

/** One line of `.gm-mock/looks.jsonl`, appended by gm-image-mock's `request-mock.py --kind look`. */
type Look = {
  time: number;
  refs: { path: string; blob: string }[];
  ok: boolean;
  answer?: string;
  error?: string;
};

type Status = 'pass' | 'fail' | 'missing' | 'blocked';
type StillResult = { path: string; status: Status; detail: string };

const VERDICT = /^[\s*_`>#-]*VERDICT:[\s*_`]*(pass|fail)\b/gim;

/** `tN.png` stills committed at HEAD inside the game folder, as repository paths with their blob ids. */
function committedStills(game: string): { path: string; blob: string }[] {
  let listing: string;
  try {
    listing = execFileSync('git', ['ls-tree', '-r', '--full-name', 'HEAD'], { cwd: game, encoding: 'utf8' });
  } catch {
    throw new UsageError('HEAD has no commit to check', 'commit the stills, then run gm look check');
  }
  return listing
    .split('\n')
    .map((line) => /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line))
    .filter((match) => match !== null && STILL.test(basename(match[2]!)))
    .map((match) => ({ path: match![2]!, blob: match![1]! }));
}

function readLooks(root: string): Look[] {
  const file = join(root, '.gm-mock', 'looks.jsonl');
  if (!existsSync(file)) return [];
  const looks: Look[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    // A torn or foreign line is skipped: a still it would have covered then reads as missing, which fails.
    try {
      const look = JSON.parse(line) as Look;
      if (Array.isArray(look.refs) && typeof look.time === 'number') looks.push(look);
    } catch {
      continue;
    }
  }
  return looks;
}

/** The newest look that judged exactly these bytes decides the still. */
function judge(root: string, still: { path: string; blob: string }, looks: Look[]): StillResult {
  const newest = looks
    .filter((look) => look.refs.some((ref) => ref.path === still.path && ref.blob === still.blob))
    .reduce<Look | null>((best, look) => (best === null || look.time >= best.time ? look : best), null);
  const { path } = still;
  if (newest === null) return { path, status: 'missing', detail: 'no look answer for this version of the still' };
  if (!newest.ok) return { path, status: 'blocked', detail: `look broker error: ${newest.error ?? 'unknown'}` };
  const answer = newest.answer === undefined ? '' : join(root, newest.answer);
  if (answer === '' || !existsSync(answer))
    return { path, status: 'missing', detail: `look answer file is gone: ${newest.answer ?? '(none)'}` };
  const verdict = [...readFileSync(answer, 'utf8').matchAll(VERDICT)].at(-1)?.[1]?.toLowerCase();
  if (verdict === 'pass') return { path, status: 'pass', detail: newest.answer! };
  if (verdict === 'fail') return { path, status: 'fail', detail: `VERDICT: fail in ${newest.answer}` };
  return { path, status: 'fail', detail: `no VERDICT line in ${newest.answer}` };
}

export const command: GmCommand = {
  name: 'look check',
  summary: 'fail unless every committed still has a passing look answer for its current bytes',
  example: 'look check',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help look check');
    const root = workspaceRoot(ctx.cwd);
    const looks = readLooks(root);
    const results = committedStills(gameDir(ctx.cwd, root)).map((still) => judge(root, still, looks));
    const blocked = results.some((result) => result.status === 'blocked');
    const ok = results.every((result) => result.status === 'pass');
    if (ctx.json) printJson(ctx, { ok, blocked, stills: results });
    else {
      for (const result of results.filter((r) => r.status !== 'pass'))
        ctx.err(`${result.status} ${result.path}: ${result.detail}`);
      if (blocked) ctx.err('look gate blocked: the look broker failed; report the PR as blocked, never as a pass');
      else if (ok) ctx.out(`look ok: ${results.length} committed stills pass`);
    }
    return ok ? EXIT.ok : EXIT.failed;
  },
};
