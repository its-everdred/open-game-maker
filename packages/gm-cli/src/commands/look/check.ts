import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { reviewScreens, sheetPath } from '../../look/screens.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { STILL } from '../shot/index.js';

/** One line of `.gm-mock/looks.jsonl`, appended by gm-image-mock's `request-mock.py --kind look`. */
type Look = {
  time: number;
  refs: { path: string; blob: string }[];
  ok: boolean;
  answer?: string;
  answer_sha256?: string;
  error?: string;
};

type Status = 'pass' | 'fail' | 'missing' | 'blocked';
type StillResult = { path: string; status: Status; detail: string };

// The whole last non-empty line of the answer: a verdict followed by more text (a retraction) is not a verdict.
const VERDICT = /^[\s*_`>#-]*VERDICT:[\s*_`]*(pass|fail)[\s*_`.]*$/i;
const LOOK_HINT = 'look at it with gm-image-mock request-mock.py --kind look (gm-verify step 6)';
const SKIP_DIRS = new Set(['node_modules', '.git', '.gm', '.gm-mock', 'dist']);

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

/** Git's blob id for these bytes, as `request-mock.py` records it. */
function blobId(data: Buffer): string {
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}

/**
 * `tN.png` stills rendered in the game folder, for repositories that never commit them (an instance repo ignores
 * `*.png`): the bytes the worker looked at are the ones on disk.
 */
function renderedStills(root: string, dir: string): { path: string; blob: string }[] {
  const found: { path: string; blob: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) found.push(...renderedStills(root, path));
    else if (entry.isFile() && STILL.test(entry.name))
      found.push({ path: relative(root, path).split(sep).join('/'), blob: blobId(readFileSync(path)) });
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
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
  if (newest === null)
    return { path, status: 'missing', detail: `no look answer for this version of the still; ${LOOK_HINT}` };
  if (!newest.ok) return { path, status: 'blocked', detail: `look broker error: ${newest.error ?? 'unknown'}` };
  const answer = newest.answer === undefined ? '' : join(root, newest.answer);
  if (answer === '' || !existsSync(answer))
    return { path, status: 'missing', detail: `look answer file is gone: ${newest.answer ?? '(none)'}` };
  const text = readFileSync(answer);
  if (createHash('sha256').update(text).digest('hex') !== newest.answer_sha256)
    return { path, status: 'missing', detail: `${newest.answer} changed after the look; ${LOOK_HINT}` };
  const last = text.toString('utf8').trimEnd().split('\n').at(-1) ?? '';
  const verdict = VERDICT.exec(last)?.[1]?.toLowerCase();
  if (verdict === 'pass') return { path, status: 'pass', detail: newest.answer! };
  if (verdict === 'fail')
    return { path, status: 'fail', detail: `VERDICT: fail in ${newest.answer}; fix what it names, then look again` };
  return { path, status: 'fail', detail: `${newest.answer} does not end in a VERDICT line` };
}

/**
 * Each screen with an approved target in review/decisions.json needs its sheet (`gm look sheet`), judged like a still:
 * a passing look answer for the sheet's bytes on disk, so a look that reads a mismatch with the target fails the check.
 */
function sheets(root: string, game: string, looks: Look[]): StillResult[] {
  let screens;
  try {
    screens = reviewScreens(game);
  } catch (error) {
    return [
      { path: 'review/decisions.json', status: 'fail', detail: error instanceof Error ? error.message : String(error) },
    ];
  }
  return screens.map((screen) => {
    const file = join(game, sheetPath(screen.name));
    const path = relative(root, file).split(sep).join('/');
    if (!existsSync(file))
      return {
        path,
        status: 'missing' as const,
        detail: `no sheet of "${screen.name}" beside its target: gm look sheet ${screen.name} --still <png>`,
      };
    return judge(root, { path, blob: blobId(readFileSync(file)) }, looks);
  });
}

export const command: GmCommand = {
  name: 'look check',
  summary: 'fail unless every still, and every screen sheet beside its approved target, has a passing look answer',
  example: 'look check',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help look check');
    const root = workspaceRoot(ctx.cwd);
    const looks = readLooks(root);
    const game = gameDir(ctx.cwd, root);
    const committed = committedStills(game);
    const stills = committed.length > 0 ? committed : renderedStills(root, game);
    const results = [...stills.map((still) => judge(root, still, looks)), ...sheets(root, game, looks)];
    const blocked = results.some((result) => result.status === 'blocked');
    // Nothing judged is not a pass: the gate is green only when at least one still was looked at.
    const ok = results.length > 0 && results.every((result) => result.status === 'pass');
    if (ctx.json) printJson(ctx, { ok, blocked, stills: results });
    else {
      for (const result of results.filter((r) => r.status !== 'pass'))
        ctx.err(`${result.status} ${result.path}: ${result.detail}`);
      if (results.length === 0) ctx.err('no tN.png stills to judge: run gm run, then look at its stills');
      if (blocked) ctx.err('look gate blocked: the look broker failed; report the PR as blocked, never as a pass');
      else if (ok) ctx.out(`look ok: ${results.length} ${committed.length > 0 ? 'committed' : 'rendered'} stills pass`);
    }
    return ok ? EXIT.ok : EXIT.failed;
  },
};
