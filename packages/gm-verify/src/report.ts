import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LIMITS, tierSchema, viewIdSchema } from '@ogm/contracts';
import { z } from 'zod';

export const GM_VERIFY_VERSION = '0.1.0';

/** V1 never checks these; every report says so (T10 §4). */
export const ALWAYS_UNCHECKED = ['iPhone Safari', 'sound'] as const;

export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|lavapipe|softpipe|mesa offscreen/i;

export const budgetStatusSchema = z.enum(['ok', 'over', 'unknown']);
export type BudgetStatus = z.infer<typeof budgetStatusSchema>;
/** `[actual, limit, status]`. */
export const budgetTupleSchema = z.tuple([z.number().min(0), z.number().min(0), budgetStatusSchema]);
export type BudgetTuple = z.infer<typeof budgetTupleSchema>;

export const BUDGET_KEYS = ['downloadBytes', 'drawCalls', 'triangles', 'textureBytes'] as const;
export type BudgetKey = (typeof BUDGET_KEYS)[number];

const relativePath = z
  .string()
  .min(1)
  .regex(
    /^(?!\/)(?![A-Za-z]:[\\/])(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/,
    'paths are forward-slash relative paths under --out',
  );

export const viewportSchema = z.enum(['desktop', 'phone', 'phone-landscape', 'tablet', 'tablet-landscape']);
export type ViewportName = z.infer<typeof viewportSchema>;
/** A viewport, or a set of them: `touch` the four touch sizes, `all` those and desktop, `both` desktop and phone. */
export const viewportSetSchema = z.enum([...viewportSchema.options, 'both', 'touch', 'all']);
export type ViewportSet = z.infer<typeof viewportSetSchema>;

export function viewportsOf(set: ViewportSet): ViewportName[] {
  const touch: ViewportName[] = ['phone', 'phone-landscape', 'tablet', 'tablet-landscape'];
  if (set === 'touch') return touch;
  if (set === 'all') return [...touch, 'desktop'];
  if (set === 'both') return ['desktop', 'phone'];
  return [set];
}

export const consoleEntrySchema = z.object({
  level: z.enum(['error', 'warning']),
  text: z.string(),
  count: z.number().int().min(1),
});
export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;

export const perfSchema = z.object({
  device: z.string(),
  cpu: z.number().min(1),
  firstMs: z.number().min(0),
  cachedMs: z.number().min(0),
  fromNetwork: z.number().int().min(0),
  fromCache: z.number().int().min(0),
  bytesByType: z.record(z.string(), z.object({ n: z.number().int().min(0), bytes: z.number().min(0) })),
  drawCalls: z.number().min(0).optional(),
  triangles: z.number().min(0).optional(),
  textureBytes: z.number().min(0).optional(),
});
export type PerfResult = z.infer<typeof perfSchema>;

/** A room's seat ceiling is the contract's, not a number restated here. */
export const MAX_REPORT_SEATS = LIMITS.maxPlayersCeiling;

/**
 * The simulated link a multiplayer run used (N6): one object, echoed into the report so a failing run reproduces from
 * its seed instead of being retyped.
 */
export const linkProfileSchema = z.object({
  seed: z.number().int(),
  latencyMs: z.number().min(0).max(1_000),
  jitterMs: z.number().min(0).max(1_000),
  lossPct: z.number().min(0).max(100),
  reorderPct: z.number().min(0).max(100),
  disconnects: z
    .array(
      z.object({
        seat: z
          .number()
          .int()
          .min(0)
          .max(MAX_REPORT_SEATS - 1),
        atMs: z.number().min(0),
        downMs: z.number().min(0),
      }),
    )
    .max(MAX_REPORT_SEATS),
});
export type LinkProfile = z.infer<typeof linkProfileSchema>;

/**
 * One client's own view of its seat (design §8.1). A metric is local: the verify scenario joins one entry per seat
 * because it owns every page, and no client uploads its numbers to another. The seat index is the identity; an account
 * id in a report file under `shots/` would be a leak for no gain.
 */
export const seatMetricsSchema = z.object({
  seat: z
    .number()
    .int()
    .min(0)
    .max(MAX_REPORT_SEATS - 1),
  buildId: z.string().min(1),
  rulesetHash: z.string().optional(),
  epoch: z.string().optional(),
  mode: z.enum(['host', 'per-seat', 'rollback']),
  tick: z.number().int().min(0),
  rttMs: z.number().min(0),
  jitterMs: z.number().min(0),
  lossPct: z.number().min(0).max(100),
  clockOffsetMs: z.number(),
  lateStartTicks: z.number().int().min(0),
  inputDelayTicks: z.number().int().min(0),
  inputGaps: z.number().int().min(0),
  localResponseMs: z.number().min(0),
  remoteUpdateP95Ms: z.number().min(0),
  eventDelayP95Ms: z.number().min(0),
  desyncs: z.number().int().min(0),
  recoveries: z.number().int().min(0),
  hardResyncs: z.number().int().min(0),
  droppedBytes: z.number().int().min(0),
  oversized: z.number().int().min(0),
});
export type SeatMetrics = z.infer<typeof seatMetricsSchema>;

/** The verify report (T10 §4, C2): `shots/report.json`, read by the build chat, analytics, repair and evals. */
export const verifyReportSchema = z.object({
  runId: z.string().min(1),
  jobId: z.string().optional(),
  aiurIssue: z.number().int().optional(),
  renderer: z.string().min(1),
  software: z.boolean(),
  viewport: viewportSetSchema,
  frame: z.enum(['app', 'bare']).optional(),
  tier: tierSchema,
  rig: viewIdSchema.optional(),
  frames: z.array(z.object({ t: z.number().min(0), path: relativePath, viewport: viewportSchema.optional() })),
  timeline: relativePath.optional(),
  clip: relativePath.optional(),
  console: z.array(consoleEntrySchema),
  budgets: z.object({
    downloadBytes: budgetTupleSchema,
    drawCalls: budgetTupleSchema,
    triangles: budgetTupleSchema,
    textureBytes: budgetTupleSchema,
  }),
  probes: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  perf: perfSchema.optional(),
  clients: z.number().int().min(1),
  /** N6 addition, additive with a default: every report written before it still parses, with no seats. */
  seats: z.array(seatMetricsSchema).max(MAX_REPORT_SEATS).default([]),
  /** N6 addition: the simulated link this run used, when it had a link simulator. */
  link: linkProfileSchema.optional(),
  unchecked: z.array(z.string()).refine((list) => ALWAYS_UNCHECKED.every((item) => list.includes(item)), {
    message: `unchecked must list ${ALWAYS_UNCHECKED.join(' and ')}`,
  }),
  verdict: z.enum(['pass', 'fail', 'error']),
  error: z.string().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  gmVerifyVersion: z.string(),
});
export type VerifyReport = z.infer<typeof verifyReportSchema>;

export const schemas = { 'verify-report.v1': verifyReportSchema } as const;

/**
 * `fail` when any budget is over or the page logged any console error (V1 has no baseline, so every error is new);
 * `error` is set by the runner, never derived.
 */
export function verdictFor(report: Pick<VerifyReport, 'budgets' | 'console'>): 'pass' | 'fail' {
  const over = BUDGET_KEYS.some((key) => report.budgets[key][2] === 'over');
  const errors = report.console.some((entry) => entry.level === 'error');
  return over || errors ? 'fail' : 'pass';
}

export function unknownBudgets(): VerifyReport['budgets'] {
  return {
    downloadBytes: [0, 0, 'unknown'],
    drawCalls: [0, 0, 'unknown'],
    triangles: [0, 0, 'unknown'],
    textureBytes: [0, 0, 'unknown'],
  };
}

/** Page-controlled text stays on its own line, so a game cannot print a fake `verdict` line into the summary. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const oneLine = (text: string): string => text.replace(/[\u0000-\u001f\u007f]+/g, ' ');

export function summaryLines(report: VerifyReport): string[] {
  const lines = [`renderer ${report.renderer}${report.software ? ' (software)' : ''}`];
  for (const key of BUDGET_KEYS) {
    const [actual, limit, status] = report.budgets[key];
    lines.push(`${key} ${actual} / ${limit} ${status}`);
  }
  for (const entry of report.console) lines.push(`console ${entry.level} x${entry.count} ${oneLine(entry.text)}`);
  if (report.error) lines.push(`error ${oneLine(report.error)}`);
  /* One line, only for a run that reported seats, so a single-client report's summary stays byte-identical. */
  if (report.seats.length > 0) {
    const sum = (key: 'desyncs' | 'recoveries') => report.seats.reduce((total, seat) => total + seat[key], 0);
    lines.push(`seats ${report.seats.length} desyncs ${sum('desyncs')} recoveries ${sum('recoveries')}`);
  }
  lines.push(`unchecked ${report.unchecked.join(', ')}`);
  lines.push(`verdict ${report.verdict}`);
  return lines;
}

/**
 * Validates, then writes `summary.txt` (one line per budget) and `report.json` into `outDir`. The report lands last and
 * by rename, so a queue poller never reads half a file.
 */
export function writeReport(outDir: string, report: VerifyReport): string {
  const parsed = verifyReportSchema.parse(report);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'summary.txt'), `${summaryLines(parsed).join('\n')}\n`);
  const path = join(outDir, 'report.json');
  writeFileSync(`${path}.tmp`, `${JSON.stringify(parsed, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
  return path;
}
