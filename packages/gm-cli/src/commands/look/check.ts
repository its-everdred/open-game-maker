import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { reviewScreens, SCREEN, sheetPath } from '../../look/screens.js';
import { SCOPE, sha256, trackedTargetMatches, visualInputs, type Scope } from '../../look/scope.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { STILL } from '../shot/index.js';

/** One line of `.gm-mock/looks.jsonl`, appended by gm-image-mock's `request-mock.py --kind look`. */
export type Look = {
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
// review/ holds evidence copied for a PR (`gm look evidence`), not the current render: judging it would let an earlier
// ticket's committed stills replace this run's.
const SKIP_DIRS = new Set(['node_modules', '.git', '.gm', '.gm-mock', 'dist', 'review']);

/** `tN.png` stills committed at HEAD inside the game folder, outside review/, as repository paths with blob ids. */
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
    .filter((match) => match !== null && STILL.test(basename(match[2]!)) && !/(^|\/)review\//.test(match[2]!))
    .map((match) => ({ path: match![2]!, blob: match![1]! }));
}

/** Git's blob id for these bytes, as `request-mock.py` records it. */
export function blobId(data: Buffer): string {
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

/** Verified captures made on this branch belong to this ticket, even when Git ignores the images. */
function ticketCapture(root: string, still: { path: string; blob: string }, ancestor: string): boolean {
  try {
    const file = join(root, '.gm/captures', `${sha256(still.path)}.json`);
    const record = JSON.parse(readFileSync(file, 'utf8')) as { source?: string; blob?: string };
    if (
      !record.source ||
      !/^[0-9a-f]{40}$/.test(record.source) ||
      record.blob !== still.blob ||
      record.source === ancestor
    )
      return false;
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, record.source], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['merge-base', '--is-ancestor', record.source, 'HEAD'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function readLooks(root: string): Look[] {
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

export function newestLook(still: { path: string; blob: string }, looks: Look[]): Look | null {
  return looks
    .filter((look) => look.refs.some((ref) => ref.path === still.path && ref.blob === still.blob))
    .reduce<Look | null>((best, look) => (best === null || look.time >= best.time ? look : best), null);
}

/** The newest look that judged exactly these bytes decides the still. */
export function judge(root: string, still: { path: string; blob: string }, looks: Look[]): StillResult {
  const newest = newestLook(still, looks);
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
    return {
      path,
      status: 'fail',
      detail: `VERDICT: fail in ${newest.answer}; fix what it names, then look again\n${text.toString('utf8').trimEnd()}`,
    };
  return {
    path,
    status: 'fail',
    detail: `${newest.answer} does not end in a VERDICT line\n${text.toString('utf8').trimEnd()}`,
  };
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
  const targetDir = join(game, 'design/flow/screens/target');
  const unrecorded: StillResult[] = existsSync(targetDir)
    ? readdirSync(targetDir, { withFileTypes: true })
        .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && /\.png$/i.test(entry.name))
        .filter((entry) => !screens.some((screen) => resolve(game, screen.target) === resolve(targetDir, entry.name)))
        .map((entry) => ({
          path: relative(root, join(targetDir, entry.name)).split(sep).join('/'),
          status: 'missing',
          detail: `approved target "${basename(entry.name, '.png')}" is not recorded in review/decisions.json`,
        }))
    : [];
  return [
    ...unrecorded,
    ...screens.map((screen) => {
      const file = join(game, sheetPath(screen.name));
      const path = relative(root, file).split(sep).join('/');
      if (!existsSync(file))
        return {
          path,
          status: 'missing' as const,
          detail: `no sheet of "${screen.name}" beside its target: gm look sheet ${screen.name} --still <png>`,
        };
      return judge(root, { path, blob: blobId(readFileSync(file)) }, looks);
    }),
  ];
}

export const command: GmCommand = {
  name: 'look check',
  summary: 'fail unless every still, and every screen sheet beside its approved target, has a passing look answer',
  example: 'look check',
  usage: '[--changed [<base>] | --all] [--screen <id> ...]',
  flags: {
    changed: { type: 'boolean', help: 'check changes against base (default origin/main)' },
    all: { type: 'boolean', help: 'audit every still and screen' },
    screen: { type: 'string', multiple: true, help: 'also check a named screen' },
  },
  async run(ctx, args, flags) {
    if (args.length > (flags.changed ? 1 : 0) || (flags.changed && flags.all))
      throw new UsageError('invalid look check arguments', 'gm help look check');
    const named = (flags.screen as string[] | undefined) ?? [];
    if (named.some((name) => !SCREEN.test(name))) throw new UsageError('invalid screen id', 'gm help look check');
    const root = workspaceRoot(ctx.cwd);
    const looks = readLooks(root);
    const game = gameDir(ctx.cwd, root);
    const committed = committedStills(game);
    const stills = committed.length > 0 ? committed : renderedStills(root, game);
    const results = [...stills.map((still) => judge(root, still, looks)), ...sheets(root, game, looks)];
    let selected = results;
    let inherited: StillResult[] = [];
    if (flags.changed) {
      const base = args[0] ?? 'origin/main';
      let changed: string[];
      let ancestor: string;
      try {
        ancestor = execFileSync('git', ['merge-base', base, 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
        changed = execFileSync('git', ['diff', '--name-only', '-z', ancestor, 'HEAD', '--'], {
          cwd: root,
          encoding: 'utf8',
        })
          .split('\0')
          .filter(Boolean);
      } catch {
        throw new UsageError(`cannot diff against ${base}`, 'provide a valid base to gm look check --changed');
      }
      let screens: ReturnType<typeof reviewScreens> = [];
      try {
        screens = reviewScreens(game);
      } catch {
        // sheets() already reports malformed decisions as a failing result.
      }
      const screenNames = new Set(named);
      const scopePath = relative(root, join(game, SCOPE)).split(sep).join('/');
      let scope: Scope | undefined;
      if (changed.includes(scopePath)) {
        try {
          scope = JSON.parse(
            execFileSync('git', ['show', `HEAD:${scopePath}`], { cwd: root, encoding: 'utf8' }),
          ) as Scope;
          if (!scope.screens || typeof scope.screens !== 'object' || Array.isArray(scope.screens))
            throw new Error('invalid screens');
          for (const name of Object.keys(scope.screens)) {
            if (!SCREEN.test(name)) throw new Error('invalid screen');
            screenNames.add(name);
          }
        } catch {
          scope = undefined;
          results.push({ path: scopePath, status: 'fail', detail: 'invalid visual scope manifest' });
        }
      }
      const inputs = visualInputs(root, game, ancestor);
      const captures = committed.length === 0 ? stills.filter((still) => ticketCapture(root, still, ancestor)) : [];
      if (
        (Object.keys(inputs).length > 0 || captures.length > 0) &&
        (!scope || Object.keys(scope.screens).length === 0)
      )
        results.push({
          path: scopePath,
          status: 'missing',
          detail:
            'visual changes need a ticket scope: gm look scope add <screen> --still <png>, then commit design/look-scope.json',
        });
      if (scope) {
        for (const path of Object.keys(inputs)) {
          const match = /(?:^|\/)screens\/(?:target\/)?([a-z0-9][a-z0-9-]*)(?:\.(?:png|tsx?|jsx?)|\/)/.exec(path);
          const name = match?.[1];
          if (name && screens.some((screen) => screen.name === name) && !scope.screens[name])
            results.push({ path: scopePath, status: 'missing', detail: `visual scope is missing screen "${name}"` });
        }
      }
      let sourceIsAncestor = false;
      if (scope && /^[0-9a-f]{40}$/.test(scope.source)) {
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', scope.source, 'HEAD'], { cwd: root });
          sourceIsAncestor = true;
        } catch {
          /* Scope must originate in this history. */
        }
      }
      if (scope && (!sourceIsAncestor || JSON.stringify(scope.inputs) !== JSON.stringify(inputs))) {
        results.push({
          path: scopePath,
          status: 'fail',
          detail: 'visual scope is stale; add the ticket screens again',
        });
        scope = undefined;
      }
      const decisionsPath = relative(root, join(game, 'review/decisions.json')).split(sep).join('/');
      if (
        changed.includes(decisionsPath) &&
        existsSync(join(game, 'review/decisions.json')) &&
        !results.some((result) => result.path === 'review/decisions.json')
      ) {
        let oldScreens: Record<string, unknown> = {};
        try {
          oldScreens =
            (
              JSON.parse(
                execFileSync('git', ['show', `${ancestor}:${decisionsPath}`], {
                  cwd: root,
                  encoding: 'utf8',
                  stdio: ['ignore', 'pipe', 'ignore'],
                }),
              ) as { screens?: Record<string, unknown> }
            ).screens ?? {};
        } catch {
          /* A new decisions file has no previous screens. */
        }
        const current = JSON.parse(readFileSync(join(game, 'review/decisions.json'), 'utf8')) as {
          screens?: Record<string, unknown>;
        };
        for (const name of Object.keys(current.screens ?? {})) {
          if (JSON.stringify(current.screens?.[name]) !== JSON.stringify(oldScreens[name])) screenNames.add(name);
        }
      }
      for (const screen of screens) {
        const paths = [screen.target, sheetPath(screen.name)].map((path) =>
          relative(root, resolve(game, path)).split(sep).join('/'),
        );
        if (paths.some((path) => changed.includes(path))) screenNames.add(screen.name);
      }
      const targetDir = relative(root, join(game, 'design/flow/screens/target')).split(sep).join('/') + '/';
      for (const path of changed) {
        if (!path.startsWith(targetDir)) continue;
        const match = /^([^/]+)\.png$/i.exec(path.slice(targetDir.length));
        if (match) screenNames.add(match[1]!);
      }
      const selectedPaths = new Set(changed);
      selectedPaths.add(scopePath);
      // Ignored renders cannot be attributed to this ticket by a Git diff. Scope evidence
      // selects the renders belonging to this ticket; other renders remain inherited.
      for (const still of captures) selectedPaths.add(still.path);
      for (const screen of screens) {
        const target = resolve(game, screen.target);
        if (!screenNames.has(screen.name)) continue;
        const sheet = join(game, sheetPath(screen.name));
        const sheetResult = results.find((result) => result.path === relative(root, sheet).split(sep).join('/'));
        if (!sheetResult) continue;
        if (!existsSync(target)) {
          sheetResult.status = 'missing';
          sheetResult.detail = `approved target is missing: ${screen.target}`;
          continue;
        }
        if (!existsSync(sheet)) continue;
        let valid = false;
        try {
          const manifest = JSON.parse(readFileSync(`${sheet}.json`, 'utf8')) as { sheet?: string; target?: string };
          const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
          valid = manifest.sheet === hash(sheet) && manifest.target === hash(target);
        } catch {
          /* Missing or invalid input record requires a fresh sheet. */
        }
        if (!valid) {
          sheetResult.status = 'missing';
          sheetResult.detail = `regenerate the sheet for the current target with gm look sheet ${screen.name} --still <png> and look again`;
        }
      }
      for (const name of screenNames) {
        selectedPaths.add(
          relative(root, join(game, sheetPath(name)))
            .split(sep)
            .join('/'),
        );
        selectedPaths.add(
          relative(root, join(game, 'design/flow/screens/target', `${name}.png`))
            .split(sep)
            .join('/'),
        );
      }
      for (const name of named) {
        if (
          !screens.some((screen) => screen.name === name) &&
          !results.some(
            (result) =>
              result.path ===
              relative(root, join(game, 'design/flow/screens/target', `${name}.png`))
                .split(sep)
                .join('/'),
          )
        )
          results.push({
            path: relative(root, join(game, sheetPath(name)))
              .split(sep)
              .join('/'),
            status: 'missing',
            detail: `no approved target for screen "${name}"`,
          });
      }
      if (scope) {
        for (const [name, entry] of Object.entries(scope.screens)) {
          if (!entry || typeof entry !== 'object') {
            results.push({ path: scopePath, status: 'fail', detail: `invalid scope evidence for "${name}"` });
            continue;
          }
          const screen = screens.find((item) => item.name === name);
          const sheet = relative(root, join(game, sheetPath(name)))
            .split(sep)
            .join('/');
          const result = results.find((item) => item.path === sheet);
          try {
            const image = Buffer.from(entry.sheet, 'base64');
            const last = entry.answer.trimEnd().split('\n').at(-1) ?? '';
            const targetPath = screen ? relative(root, resolve(game, screen.target)).split(sep).join('/') : '';
            const committedTargetMatches = trackedTargetMatches(root, scope.source, targetPath, entry.targetHash);
            const valid =
              screen &&
              committedTargetMatches &&
              entry.target === screen.target &&
              sha256(Buffer.from(entry.targetImage, 'base64')) === entry.targetHash &&
              (!existsSync(resolve(game, screen.target)) ||
                sha256(readFileSync(resolve(game, screen.target))) === entry.targetHash) &&
              Array.isArray(entry.stills) &&
              entry.stills.some((still) => sha256(Buffer.from(still.image, 'base64')) === entry.sheetStill) &&
              blobId(image) === entry.sheetBlob &&
              Number.isFinite(entry.proof.time) &&
              entry.proof.refs.some((ref) => ref.path === sheet && ref.blob === entry.sheetBlob) &&
              entry.proof.answerHash === sha256(entry.answer) &&
              VERDICT.exec(last)?.[1]?.toLowerCase() === 'pass';
            if (
              valid &&
              result &&
              (!newestLook({ path: sheet, blob: entry.sheetBlob }, looks) ||
                newestLook({ path: sheet, blob: entry.sheetBlob }, looks)!.time < entry.proof.time) &&
              (!existsSync(join(game, sheetPath(name))) ||
                blobId(readFileSync(join(game, sheetPath(name)))) === entry.sheetBlob)
            )
              Object.assign(result, { status: 'pass', detail: 'recorded scope evidence' });
            else if (!valid && result)
              Object.assign(result, { status: 'fail', detail: `invalid scope evidence for "${name}"` });
            else if (!valid)
              results.push({ path: sheet, status: 'fail', detail: `invalid scope evidence for "${name}"` });
          } catch {
            if (result) Object.assign(result, { status: 'fail', detail: `invalid scope evidence for "${name}"` });
            else results.push({ path: sheet, status: 'fail', detail: `invalid scope evidence for "${name}"` });
          }
          if (!Array.isArray(entry.stills) || entry.stills.length === 0) {
            results.push({ path: scopePath, status: 'fail', detail: `invalid still evidence for "${name}"` });
            continue;
          }
          for (const evidence of entry.stills) {
            if (!evidence || typeof evidence !== 'object' || typeof evidence.path !== 'string') {
              results.push({ path: scopePath, status: 'fail', detail: `invalid still evidence for "${name}"` });
              continue;
            }
            selectedPaths.add(evidence.path);
            try {
              const candidate = resolve(root, evidence.path);
              if (relative(game, candidate).startsWith('..') || !STILL.test(basename(candidate)))
                throw new Error('invalid still path');
              const image = Buffer.from(evidence.image, 'base64');
              const last = evidence.answer.trimEnd().split('\n').at(-1) ?? '';
              const tracked = stills.find((item) => item.path === evidence.path);
              const valid =
                blobId(image) === evidence.blob &&
                (!tracked || tracked.blob === evidence.blob) &&
                Number.isFinite(evidence.proof.time) &&
                evidence.proof.refs.some((ref) => ref.path === evidence.path && ref.blob === evidence.blob) &&
                evidence.proof.answerHash === sha256(evidence.answer) &&
                VERDICT.exec(last)?.[1]?.toLowerCase() === 'pass';
              const item = results.find((result) => result.path === evidence.path);
              if (!valid)
                results.push({ path: scopePath, status: 'fail', detail: `invalid still evidence for "${name}"` });
              else if (existsSync(candidate) && blobId(readFileSync(candidate)) !== evidence.blob)
                results.push({
                  path: evidence.path,
                  status: 'fail',
                  detail: 'still differs from recorded scope evidence',
                });
              else if (
                item &&
                (!newestLook({ path: evidence.path, blob: evidence.blob }, looks) ||
                  newestLook({ path: evidence.path, blob: evidence.blob }, looks)!.time < evidence.proof.time) &&
                (!existsSync(join(root, evidence.path)) ||
                  blobId(readFileSync(join(root, evidence.path))) === evidence.blob)
              )
                Object.assign(item, { status: 'pass', detail: 'recorded scope evidence' });
              else if (!item) {
                selectedPaths.add(evidence.path);
                const live = newestLook({ path: evidence.path, blob: evidence.blob }, looks);
                results.push(
                  live && live.time >= evidence.proof.time
                    ? judge(root, { path: evidence.path, blob: evidence.blob }, looks)
                    : { path: evidence.path, status: 'pass', detail: 'recorded scope evidence' },
                );
              }
            } catch {
              results.push({ path: scopePath, status: 'fail', detail: `invalid still evidence for "${name}"` });
            }
          }
        }
      }
      selected = results.filter((result) => selectedPaths.has(result.path) || result.path === 'review/decisions.json');
      inherited = results.filter((result) => !selected.includes(result) && result.status !== 'pass');
    }
    const blocked = selected.some((result) => result.status === 'blocked');
    // A full audit must judge something; a changed scope can legitimately be empty.
    const ok = (flags.changed || selected.length > 0) && selected.every((result) => result.status === 'pass');
    if (ctx.json) printJson(ctx, { ok, blocked, stills: selected, ...(flags.changed ? { inherited } : {}) });
    else {
      for (const result of selected.filter((r) => r.status !== 'pass'))
        ctx.err(`${result.status} ${result.path}: ${result.detail}`);
      if (inherited.length > 0) {
        ctx.err('inherited:');
        for (const result of inherited) ctx.err(`${result.status} ${result.path}: ${result.detail}`);
      }
      if (!flags.changed && results.length === 0)
        ctx.err('no tN.png stills to judge: run gm run, then look at its stills');
      if (blocked) ctx.err('look gate blocked: the look broker failed; report the PR as blocked, never as a pass');
      else if (ok)
        ctx.out(`look ok: ${selected.length} ${committed.length > 0 ? 'committed' : 'rendered'} stills pass`);
    }
    return ok ? EXIT.ok : EXIT.failed;
  },
};
