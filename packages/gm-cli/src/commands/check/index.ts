import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import type { GateResult, RunL0Options } from '@ogm/gm-verify';

import { EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { command as assetsCommand } from './assets.js';
import { command as lookCommand } from '../look/check.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { checkLoading } from '../../loading-check.js';
import { checkPlayArea } from '../../play-area-check.js';
import { findPlayAreaGame } from '../../play-area-config.js';
import { checkPrReview } from '../../pr-review-check.js';
import { recipeSchema } from '../../sprite-forge.js';

function ticketLabels(body: string): Set<string> {
  return new Set(
    [...body.matchAll(/(?:^|\s)(lane:[a-z-]+|phase:[a-z-]+)(?=\s|$)/gim)].map((match) => match[1]!.toLowerCase()),
  );
}

function ticketGate(cwd: string, body: string, base: string, lane?: string, phase?: string): string[] {
  const labels = ticketLabels(body);
  if (lane) labels.add(`lane:${lane}`);
  if (phase) labels.add(`phase:${phase}`);
  if (!labels.has('lane:creative') && !labels.has('lane:clone')) return [];
  const problems: string[] = [];
  let changed: string[];
  try {
    changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [`cannot compare ticket changes with base ${base}`];
  }
  const effectiveLabels = new Set(labels);
  if (effectiveLabels.has('lane:creative') && effectiveLabels.has('phase:mock')) {
    const source = changed.filter((path) => /^(?:games\/[^/]+\/src|src)\//.test(path));
    if (source.length) problems.push(`phase:mock may not change game source: ${source.join(', ')}`);
  }
  if (
    effectiveLabels.has('lane:creative') &&
    (effectiveLabels.has('phase:prototype') || effectiveLabels.has('phase:build'))
  ) {
    const ticketNumber = /\b(?:closes|refs|fixes|resolves)\s+#(\d+)/i.exec(body)?.[1];
    let game = cwd;
    let root = cwd;
    try {
      root = workspaceRoot(cwd);
      game = gameDir(cwd, root);
    } catch {
      // The ticket gate can run in a bare worktree fixture without a manifest.
    }
    const slug = basename(game);
    const decisionFiles = [join(game, 'review/decisions.json'), join(root, 'docs', slug, 'decisions.json')];
    const recorded = decisionFiles.some((path) => {
      try {
        const value = JSON.parse(readFileSync(path, 'utf8')) as {
          screens?: Record<string, { target?: string }>;
          decisions?: { ticket?: number | null; status?: string; answer?: string | null; options?: { media?: string }[] }[];
        } | { ticket?: number | null; status?: string; answer?: string | null; options?: { media?: string }[] }[];
        if (Array.isArray(value))
          return value.some(
            (decision) =>
              decision.ticket === Number(ticketNumber) &&
              decision.status === 'answered' &&
              typeof decision.answer === 'string' &&
              decision.options?.some((option) => typeof option.media === 'string'),
          );
        return (
          Object.values(value.screens ?? {}).some(
            (screen) => typeof screen.target === 'string' && screen.target.length > 0,
          ) ||
          (Array.isArray(value.decisions) &&
            value.decisions.some(
              (decision) =>
                decision.ticket === Number(ticketNumber) &&
                decision.status === 'answered' &&
                typeof decision.answer === 'string' &&
                decision.options?.some((option) => typeof option.media === 'string'),
            ))
        );
      } catch {
        return false;
      }
    });
    if (!recorded)
      problems.push(
        `lane:creative ${effectiveLabels.has('phase:build') ? 'phase:build needs an approved prototype' : 'phase:prototype needs an approved mock'} recorded in review/decisions.json or docs/<slug>/decisions.json`,
      );
  }
  if (effectiveLabels.has('lane:clone')) {
    const recipeFiles = changed.filter((path) => path.endsWith('/recipe.json') || path === 'recipe.json');
    if (!recipeFiles.length) problems.push('lane:clone requires a recipe.json in the PR');
    for (const path of recipeFiles) {
      try {
        const value: unknown = JSON.parse(readFileSync(join(cwd, path), 'utf8'));
        const parsed = recipeSchema.safeParse(value);
        if (!parsed.success) {
          problems.push(`${path} is not a valid sprite-forge recipe`);
          continue;
        }
        const recipe = parsed.data;
        if (!recipe.approved_by_creator) problems.push(`${path} has no creator approval`);
        const roundPrefix = path.slice(0, -'recipe.json'.length);
        const originalPrefix = `${roundPrefix}originals/`;
        const attachedOriginals = changed.filter(
          (candidate) => candidate.startsWith(originalPrefix) && /\.(?:png|jpe?g|webp)$/i.test(candidate),
        );
        if (attachedOriginals.length === 0)
          problems.push(`${path} has no original media attached under ${originalPrefix}`);
        if (Object.keys(recipe.scores).length === 0) problems.push(`${path} has no gm-sprite-forge gate scores`);
        if (
          !recipe.gate_results ||
          Object.keys(recipe.gate_results).length === 0 ||
          Object.values(recipe.gate_results).some((result) => result.pass !== true)
        )
          problems.push(`${path} has missing or failing gm-sprite-forge gate results`);
      } catch {
        problems.push(`${path} is not readable JSON`);
      }
    }
  }
  return problems;
}

export function printGate(ctx: GmContext, result: GateResult): number {
  if (ctx.json) ctx.out(JSON.stringify(result));
  else {
    for (const check of result.checks.filter((item) => !item.ok)) {
      const location = check.file
        ? `${check.file}${check.line === undefined ? '' : `:${check.line}`} `
        : `${check.id} `;
      ctx.err(`${location}${check.detail ?? 'failed'}`);
    }
  }
  return result.ok ? EXIT.ok : EXIT.failed;
}

export async function runSelected(ctx: GmContext, checks: RunL0Options): Promise<number> {
  const verify = await import('@ogm/gm-verify');
  return printGate(ctx, verify.runL0(ctx.cwd, checks));
}

export const command: GmCommand = {
  name: 'check',
  summary: 'run deterministic static, hook, and asset gates',
  usage: '[--body <file>] [--base <ref>] [--lane <creative|clone>] [--phase <mock|prototype|build|polish>] [--json]',
  example: 'check',
  flags: {
    body: { type: 'string', help: 'pull request body markdown for ticket PR gates' },
    base: { type: 'string', help: 'base ref for changed-file detection (default origin/main)' },
    lane: { type: 'string', help: 'ticket lane for ticket PR gates: creative or clone' },
    phase: { type: 'string', help: 'current look rung: mock, prototype, build, or polish' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help check');
    const phase = flags.phase as string | undefined;
    if (phase !== undefined && !['mock', 'prototype', 'build', 'polish'].includes(phase))
      throw new UsageError(`invalid look phase "${phase}"`, 'use --phase mock|prototype|build|polish');
    const lane = flags.lane as string | undefined;
    if (lane !== undefined && !['creative', 'clone'].includes(lane))
      throw new UsageError(`invalid ticket lane "${lane}"`, 'use --lane creative|clone');
    const verify = await import('@ogm/gm-verify');
    const gate = verify.runL0(ctx.cwd);

    const out: string[] = [];
    const err: string[] = [];
    const assetCode = await assetsCommand.run(
      { ...ctx, out: (line) => out.push(line), err: (line) => err.push(line) },
      [],
      {},
    );
    let lookCode: number = EXIT.ok;
    let lookReport: unknown;
    let loadingErrors: string[] = [];
    let playArea: Awaited<ReturnType<typeof checkPlayArea>> | undefined;
    const prProblems =
      typeof flags.body === 'string'
        ? [
            ...checkPrReview(ctx.cwd, flags.body, typeof flags.base === 'string' ? flags.base : 'origin/main'),
            ...ticketGate(
              ctx.cwd,
              (() => {
                try {
                  return readFileSync(resolve(ctx.cwd, flags.body as string), 'utf8');
                } catch {
                  return '';
                }
              })(),
              typeof flags.base === 'string' ? flags.base : 'origin/main',
              lane,
              phase,
            ),
          ]
        : [];
    if (!ctx.json) prProblems.forEach(ctx.err);
    let game = ctx.cwd;
    try {
      game = gameDir(ctx.cwd);
    } catch {
      // The static gate also works outside a game repository.
    }
    const playAreaGame = findPlayAreaGame(ctx.cwd, game);
    if (playAreaGame) {
      playArea = await checkPlayArea(ctx, playAreaGame);
      if (!ctx.json) playArea.output.forEach(playArea.ok ? ctx.out : ctx.err);
    }
    if (existsSync(join(game, 'gm.manifest.json'))) {
      loadingErrors = await checkLoading(game);
      if (!ctx.json) loadingErrors.forEach(ctx.err);
      const lookOut: string[] = [];
      lookCode = await lookCommand.run({ ...ctx, json: true, fields: null, out: (line) => lookOut.push(line) }, [], {
        changed: true,
        phase,
      });
      lookReport = JSON.parse(lookOut.join('\n'));
      if (!ctx.json) {
        const report = lookReport as {
          stills: { status: string; path: string; detail: string }[];
          inherited: { status: string; path: string; detail: string }[];
        };
        for (const item of report.stills.filter((item) => item.status === 'warning'))
          ctx.err(`warning ${item.path}: ${item.detail}`);
        for (const item of report.stills.filter((item) => item.status !== 'pass'))
          if (item.status !== 'warning') ctx.err(`${item.status} ${item.path}: ${item.detail}`);
        if (report.inherited.length > 0) {
          ctx.err('inherited:');
          for (const item of report.inherited) ctx.err(`${item.status} ${item.path}: ${item.detail}`);
        }
      }
    }
    const ok =
      gate.ok &&
      assetCode === EXIT.ok &&
      lookCode === EXIT.ok &&
      loadingErrors.length === 0 &&
      playArea?.ok !== false &&
      prProblems.length === 0;
    if (ctx.json && (lookReport !== undefined || playArea !== undefined || typeof flags.body === 'string'))
      ctx.out(
        JSON.stringify({
          ...gate,
          ok,
          look: lookReport,
          loadingErrors,
          playArea,
          prototypeReview: typeof flags.body === 'string' ? { problems: prProblems } : undefined,
        }),
      );
    else printGate(ctx, { ...gate, ok, checks: gate.checks });
    if (assetCode !== EXIT.ok) {
      out.forEach(ctx.out);
      err.forEach(ctx.err);
    }
    return ok ? EXIT.ok : EXIT.failed;
  },
};
