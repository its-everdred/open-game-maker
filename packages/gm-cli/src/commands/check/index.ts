import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { GateResult, RunL0Options } from '@ogm/gm-verify';

import { EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { command as assetsCommand } from './assets.js';
import { command as lookCommand } from '../look/check.js';
import { gameDir } from '../../outbox.js';
import { checkLoading } from '../../loading-check.js';
import { checkPlayArea } from '../../play-area-check.js';
import { findPlayAreaGame } from '../../play-area-config.js';
import { checkPrReview } from '../../pr-review-check.js';

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
  usage: '[--body <file>] [--base <ref>] [--phase <mock|prototype|build|polish>] [--json]',
  example: 'check',
  flags: {
    body: { type: 'string', help: 'pull request body markdown for ticket PR gates' },
    base: { type: 'string', help: 'base ref for changed-file detection (default origin/main)' },
    phase: { type: 'string', help: 'current look rung: mock, prototype, build, or polish' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help check');
    const phase = flags.phase as string | undefined;
    if (phase !== undefined && !['mock', 'prototype', 'build', 'polish'].includes(phase))
      throw new UsageError(`invalid look phase "${phase}"`, 'use --phase mock|prototype|build|polish');
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
        ? checkPrReview(ctx.cwd, flags.body, typeof flags.base === 'string' ? flags.base : 'origin/main')
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
