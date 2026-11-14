import { resolve } from 'node:path';

import type { GateResult } from '@ogm/gm-verify';

import { UsageError, type GmCommand } from '../../command.js';
import { niceCapture } from '../run/index.js';
import { printGate } from '../check/index.js';
import { testSoftwareRenderer } from '../../test-renderer.js';
import { checkBoot } from '../check/boot.js';

export const command: GmCommand = {
  name: 'test',
  summary: 'run the deterministic browser smoke gate',
  usage: '[--inputs script.json] [--ticks 3600] [--deadline seconds] [--serve dist] [--json]',
  example: 'test --ticks 3600',
  flags: {
    inputs: { type: 'string', help: 'logical input script JSON' },
    ticks: { type: 'number', default: 3_600, help: 'fixed simulation ticks to advance' },
    deadline: { type: 'number', help: 'overall deadline in seconds' },
    serve: { type: 'string', default: 'dist', help: 'built game directory to serve on loopback' },
    out: { type: 'string', default: 'shots/test', help: 'gate report and HUD still directory' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help test');
    const ticks = flags.ticks as number;
    if (ticks < 1) throw new UsageError('--ticks must be at least 1', 'gm test --ticks 3600');
    if (flags.deadline !== undefined && (!Number.isFinite(flags.deadline) || (flags.deadline as number) <= 0))
      throw new UsageError('--deadline must be a positive number of seconds', 'gm help test');
    const verify = await import('@ogm/gm-verify');
    let inputs;
    if (typeof flags.inputs === 'string') {
      try {
        inputs = verify.readInputScript(resolve(ctx.cwd, flags.inputs));
      } catch (error) {
        const cause = error instanceof Error ? error.message.split('\n')[0] : String(error);
        throw new UsageError(`--inputs could not be read: ${cause}`, 'gm test --inputs script.json');
      }
    }

    const started = Date.now();
    const deadlineMs =
      flags.deadline !== undefined
        ? (flags.deadline as number) * 1_000
        : Math.min(1_200_000, 120_000 + (ticks / 30) * 1_000);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<GateResult>((resolveTimeout) => {
      timer = setTimeout(() => {
        controller.abort();
        ctx.onTestTimeout?.();
        resolveTimeout({
          gate: 'L1',
          ok: false,
          durationMs: Date.now() - started,
          checks: [{ id: 'boot', ok: false, detail: 'overall deadline exceeded during boot' }],
        });
      }, deadlineMs);
    });
    let boot: GateResult;
    try {
      boot = await Promise.race([
        checkBoot(ctx, flags.serve as string, undefined, controller.signal, started + deadlineMs),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (!boot.ok) return printGate(ctx, boot);
    const remainingMs = Math.max(1, deadlineMs - (Date.now() - started));

    niceCapture();
    const result = await verify.runL1(ctx.cwd, {
      serveDir: flags.serve as string,
      outDir: resolve(ctx.cwd, flags.out as string),
      ...(inputs ? { inputs } : {}),
      ticks,
      deadlineMs: remainingMs,
      progress: ctx.json ? ctx.err : ctx.out,
      onTimeout: (reason: string) => {
        ctx.err(`${reason}; writing diagnostic to ${resolve(ctx.cwd, flags.out as string)}`);
        ctx.onTestTimeout?.();
      },
      software: testSoftwareRenderer(ctx.config.verifySoftwareGlConfigured ? ctx.config.verifySoftwareGl : undefined),
      slots: { runtimeDir: ctx.config.runtimeDir },
      eventsFile: ctx.config.eventsFile,
      jobId: ctx.config.jobId,
      aiurIssue: ctx.config.aiurIssue,
      aiurRunId: ctx.config.aiurRunId,
      source: 'gm test',
    });
    const code = printGate(ctx, result);
    if (!ctx.json && result.ok && result.report) ctx.out(`${result.report}  L1 pass`);
    return code;
  },
};
