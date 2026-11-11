import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { GateResult, RunL0Options } from '@ogm/gm-verify';

import { EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { command as assetsCommand } from './assets.js';
import { command as lookCommand } from '../look/check.js';
import { gameDir } from '../../outbox.js';

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
  usage: '[--json]',
  example: 'check',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help check');
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
    let game = ctx.cwd;
    try {
      game = gameDir(ctx.cwd);
    } catch {
      // The static gate also works outside a game repository.
    }
    if (existsSync(join(game, 'gm.manifest.json'))) {
      const lookOut: string[] = [];
      lookCode = await lookCommand.run({ ...ctx, json: true, fields: null, out: (line) => lookOut.push(line) }, [], {
        changed: true,
      });
      lookReport = JSON.parse(lookOut.join('\n'));
      if (!ctx.json) {
        const report = lookReport as {
          stills: { status: string; path: string; detail: string }[];
          inherited: { status: string; path: string; detail: string }[];
        };
        for (const item of report.stills.filter((item) => item.status !== 'pass'))
          ctx.err(`${item.status} ${item.path}: ${item.detail}`);
        if (report.inherited.length > 0) {
          ctx.err('inherited:');
          for (const item of report.inherited) ctx.err(`${item.status} ${item.path}: ${item.detail}`);
        }
      }
    }
    const gateCode =
      ctx.json && lookReport !== undefined
        ? (ctx.out(
            JSON.stringify({ ...gate, ok: gate.ok && assetCode === EXIT.ok && lookCode === EXIT.ok, look: lookReport }),
          ),
          gate.ok ? EXIT.ok : EXIT.failed)
        : printGate(ctx, gate);
    if (assetCode !== EXIT.ok) {
      out.forEach(ctx.out);
      err.forEach(ctx.err);
    }
    return gateCode === EXIT.ok && assetCode === EXIT.ok && lookCode === EXIT.ok ? EXIT.ok : EXIT.failed;
  },
};
