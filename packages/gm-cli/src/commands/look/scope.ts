import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { reviewScreens, SCREEN, sheetPath } from '../../look/screens.js';
import { captureMetadataPath } from '../../look/run-provenance.js';
import { SCOPE, sha256, visualInputs, type Scope, type StillEvidence, type LookProof } from '../../look/scope.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { blobId, judge, newestLook, readLooks } from './check.js';
import { STILL } from '../shot/index.js';

export const command: GmCommand = {
  name: 'look scope add',
  summary: 'record a ticket screen and its passing visual evidence',
  usage: '<screen> [--still <png> ...]',
  flags: {
    still: { type: 'string', multiple: true, help: 'record a looked-at still for this screen' },
    base: { type: 'string', help: 'diff base (default origin/main)' },
  },
  async run(ctx, args, flags) {
    const [name, extra] = args;
    if (!name || extra || !SCREEN.test(name)) throw new UsageError('name one screen', 'gm look scope add <screen>');
    const root = workspaceRoot(ctx.cwd);
    const game = gameDir(ctx.cwd, root);
    const screen = reviewScreens(game).find((item) => item.name === name);
    if (!screen) throw new UsageError(`no approved target for "${name}"`, 'record the screen in review/decisions.json');
    const target = resolve(game, screen.target);
    const sheet = join(game, sheetPath(name));
    if (!existsSync(target) || !existsSync(sheet) || !existsSync(`${sheet}.json`))
      throw new UsageError(`missing target or sheet for "${name}"`, `gm look sheet ${name} --still <png>`);
    const data = readFileSync(sheet);
    const targetHash = sha256(readFileSync(target));
    const sheetInputs = JSON.parse(readFileSync(`${sheet}.json`, 'utf8')) as {
      sheet?: string;
      target?: string;
      still?: string;
    };
    if (sheetInputs.sheet !== sha256(data) || sheetInputs.target !== targetHash)
      throw new UsageError(`stale sheet for "${name}"`, `gm look sheet ${name} --still <png>`);
    const path = relative(root, sheet).split(sep).join('/');
    const looks = readLooks(root);
    const judged = judge(root, { path, blob: blobId(data) }, looks);
    if (judged.status !== 'pass')
      throw new UsageError(`${judged.status} ${path}: ${judged.detail}`, 'look at the sheet and try again');
    const proofFor = (ref: { path: string; blob: string }): LookProof => {
      const found = newestLook(ref, looks);
      if (!found?.ok || !found.answer_sha256) throw new UsageError('missing look proof', 'look again');
      return { time: found.time, refs: found.refs, answerHash: found.answer_sha256 };
    };
    const file = join(game, SCOPE);
    let scope: Scope = { source: '', inputs: {}, screens: {} };
    const base = typeof flags.base === 'string' ? flags.base : 'origin/main';
    if (existsSync(file)) {
      const repoPath = relative(root, file).split(sep).join('/');
      let previous = '';
      try {
        previous = execFileSync('git', ['show', `${base}:${repoPath}`], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        /* No prior scope. */
      }
      const current = readFileSync(file, 'utf8');
      if (current !== previous) scope = JSON.parse(current) as Scope;
    }
    const requestedStills = (flags.still as string[] | undefined) ?? [];
    if (requestedStills.length === 0)
      throw new UsageError('at least one looked-at still is required', 'gm look scope add <screen> --still <png>');
    const requestedPaths = new Set(
      requestedStills.map((input) => relative(root, resolve(ctx.cwd, input)).split(sep).join('/')),
    );
    const scopePath = relative(root, file).split(sep).join('/');
    const reviewPrefix = relative(root, join(game, 'review')).split(sep).join('/') + '/';
    const stills: StillEvidence[] = requestedStills.map((input) => {
      const absolute = resolve(ctx.cwd, input);
      const path = relative(root, absolute).split(sep).join('/');
      if (
        path.startsWith('../') ||
        relative(game, absolute).startsWith('..') ||
        !STILL.test(basename(absolute)) ||
        !existsSync(absolute)
      )
        throw new UsageError(`invalid still ${input}`, 'gm look scope add <screen> --still <png>');
      const data = readFileSync(absolute);
      const blob = blobId(data);
      let capture: { source?: string; blob?: string; outputs?: Record<string, string> };
      try {
        capture = JSON.parse(readFileSync(captureMetadataPath(ctx.cwd, absolute), 'utf8')) as {
          source?: string;
          blob?: string;
          outputs?: Record<string, string>;
        };
      } catch {
        throw new UsageError(
          `missing capture provenance for ${input}`,
          'commit changes and rerun gm run --verify-source',
        );
      }
      let current = false;
      if (capture.source && /^[0-9a-f]{40}$/.test(capture.source) && capture.blob === blob) {
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', capture.source, 'HEAD'], { cwd: root, stdio: 'ignore' });
          const changes = execFileSync('git', ['diff', '--name-only', '-z', capture.source, 'HEAD', '--'], {
            cwd: root,
            encoding: 'utf8',
          })
            .split('\0')
            .filter(Boolean);
          const capturedOutput = (changed: string): boolean => {
            if (!capture.outputs?.[changed]) return false;
            try {
              return (
                execFileSync('git', ['rev-parse', `HEAD:${changed}`], {
                  cwd: root,
                  encoding: 'utf8',
                  stdio: ['ignore', 'pipe', 'ignore'],
                }).trim() === capture.outputs[changed]
              );
            } catch {
              return false;
            }
          };
          current = changes.every(
            (changed) =>
              requestedPaths.has(changed) ||
              capturedOutput(changed) ||
              changed === scopePath ||
              (changed.startsWith(reviewPrefix) && /^\d+\//.test(changed.slice(reviewPrefix.length))),
          );
        } catch {
          /* A capture outside this history is stale. */
        }
      }
      if (!current)
        throw new UsageError(`stale capture for ${input}`, 'commit changes and rerun gm run --verify-source');
      const result = judge(root, { path, blob }, readLooks(root));
      if (result.status !== 'pass')
        throw new UsageError(`${result.status} ${path}: ${result.detail}`, 'look at the still and try again');
      return {
        path,
        image: data.toString('base64'),
        blob,
        answer: readFileSync(join(root, result.detail), 'utf8'),
        proof: proofFor({ path, blob }),
      };
    });
    try {
      execFileSync('git', ['diff', '--quiet', 'HEAD', '--', '.', `:(exclude)${scopePath}`], { cwd: root });
    } catch {
      throw new UsageError(
        'commit tracked changes before adding visual scope',
        'commit changes, then run gm look scope add <screen>',
      );
    }
    const ancestor = execFileSync('git', ['merge-base', base, 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const inputs = visualInputs(root, game, ancestor);
    if (JSON.stringify(scope.inputs) !== JSON.stringify(inputs)) scope.screens = {};
    scope.source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    scope.inputs = inputs;
    for (const [otherName, other] of Object.entries(scope.screens)) {
      if (otherName === name) continue;
      const otherTarget = resolve(game, other.target);
      const staleTarget = existsSync(otherTarget) && sha256(readFileSync(otherTarget)) !== other.targetHash;
      const staleStill = other.stills.some((still) => {
        const file = resolve(root, still.path);
        return existsSync(file) && blobId(readFileSync(file)) !== still.blob;
      });
      if (staleTarget || staleStill)
        throw new UsageError(`scope for "${otherName}" is stale`, `gm look scope add ${otherName} --still <png>`);
    }
    if (!stills.some((still) => sha256(Buffer.from(still.image, 'base64')) === sheetInputs.still))
      throw new UsageError('scope still does not match the sheet', `gm look sheet ${name} --still <png>`);
    scope.screens[name] = {
      target: screen.target,
      targetHash,
      targetImage: readFileSync(target).toString('base64'),
      sheetStill: sheetInputs.still!,
      sheet: data.toString('base64'),
      sheetBlob: blobId(data),
      answer: readFileSync(join(root, judged.detail), 'utf8'),
      proof: proofFor({ path, blob: blobId(data) }),
      stills,
    };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(scope, null, 2) + '\n');
    if (ctx.json) printJson(ctx, { screen: name, scope: relative(root, file).split(sep).join('/') });
    else ctx.out(`recorded visual scope: ${name}`);
    return EXIT.ok;
  },
};
