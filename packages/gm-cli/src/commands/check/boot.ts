import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import type { BootViewport, GateResult } from '@ogm/gm-verify';

import { UsageError, type GmCommand, type GmContext } from '../../command.js';
import { printGate } from './index.js';
import { testSoftwareRenderer } from '../../test-renderer.js';

export async function checkBoot(
  ctx: GmContext,
  dist: string,
  viewports: readonly BootViewport[] = ['phone', 'tablet-landscape'],
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<GateResult> {
  const started = Date.now();
  const verify = await import('@ogm/gm-verify');
  const outDir = resolve(ctx.cwd, 'shots/boot');
  try {
    if (ctx.config.verifyQueue) {
      const dir = verify.submitRequest(ctx.cwd, {
        v: 1,
        runId: verify.newRunId(),
        ...(ctx.config.jobId ? { jobId: ctx.config.jobId } : {}),
        ...(ctx.config.aiurIssue !== undefined ? { aiurIssue: ctx.config.aiurIssue } : {}),
        ...(ctx.config.aiurRunId ? { aiurRunId: ctx.config.aiurRunId } : {}),
        serveDir: relative(ctx.cwd, resolve(ctx.cwd, dist)) || '.',
        ...(deadlineAt !== undefined ? { deadlineAt } : {}),
        args: { boot: true, viewport: viewports.length === 2 ? 'both' : viewports[0]!, tier: 'mobile' },
      });
      const report = await verify.waitForReport(dir, { signal });
      mkdirSync(outDir, { recursive: true });
      for (const frame of report.frames) copyFileSync(join(dir, frame.path), join(outDir, basename(frame.path)));
      return {
        gate: 'L1',
        ok: report.verdict === 'pass',
        durationMs: Date.now() - started,
        checks: [{ id: 'boot', ok: report.verdict === 'pass', ...(report.error ? { detail: report.error } : {}) }],
      };
    }
    const server = await verify.serveStatic(resolve(ctx.cwd, dist));
    try {
      return await verify.runBoot({
        url: server.url,
        outDir,
        viewports,
        signal,
        runtimeDir: ctx.config.runtimeDir,
        software: testSoftwareRenderer(ctx.config.verifySoftwareGlConfigured ? ctx.config.verifySoftwareGl : undefined),
      });
    } finally {
      await server.close();
    }
  } catch (error) {
    return {
      gate: 'L1',
      ok: false,
      durationMs: Date.now() - started,
      checks: [{ id: 'boot', ok: false, detail: error instanceof Error ? error.message : String(error) }],
    };
  }
}

export const command: GmCommand = {
  name: 'check boot',
  summary: 'check that the built game starts with a visible frame',
  usage: '[--dist dir] [--viewport both|phone|tablet-landscape] [--json]',
  example: 'check boot --dist dist',
  flags: {
    dist: { type: 'string', default: 'dist', help: 'built game directory' },
    viewport: { type: 'string', default: 'both', help: 'both, phone, or tablet-landscape' },
  },
  async run(ctx, args, flags) {
    if (args.length) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help check boot');
    const viewport = flags.viewport;
    if (viewport !== 'both' && viewport !== 'phone' && viewport !== 'tablet-landscape')
      throw new UsageError('--viewport must be both, phone, or tablet-landscape', 'gm help check boot');
    const viewports: BootViewport[] = viewport === 'both' ? ['phone', 'tablet-landscape'] : [viewport];
    return printGate(ctx, await checkBoot(ctx, flags.dist as string, viewports));
  },
};
