import { z } from 'zod';

import { Id, IsoTime } from './api.js';

export const ReportFrame = z.object({
  file: z.string().max(300),
  line: z.number().int(),
  col: z.number().int().optional(),
  fn: z.string().max(120).optional(),
});
export const ReportError = z.object({
  type: z.string().max(80),
  message: z.string().max(1000),
  frames: z.array(ReportFrame).max(50),
});
export const CreateReport = z.object({
  gameId: Id,
  releaseId: Id.optional(),
  buildHash: z.string().regex(/^[0-9a-f]{64}$/),
  text: z.string().max(2000).optional(),
  error: ReportError.optional(),
  bundleKey: z.string().max(200).optional(),
});
export const ReportRoute = z.enum(['game_repair', 'platform', 'editor_hint', 'stored']);
export const CreateReportResponse = z.object({
  reportId: Id,
  signature: z.string().length(64),
  route: ReportRoute,
  jobId: Id.optional(),
  pendingBudget: z.literal(true).optional(),
  budgetReason: z.literal('weekly_user').optional(),
  resetsAt: IsoTime.optional(),
});
export interface IssueWriter {
  file(input: { title: string; body: string; labels: string[] }): Promise<{ ref: string }>;
} // never carries agent:todo

export const ReplayClass = z.enum(['reproduces_with_error', 'reproduces_no_error', 'not_reproducible']);
export const ReplayReason = z.enum(['no_actions', 'no_keyframe', 'state_mismatch', 'timeout']);
export const ReplayResult = z.strictObject({
  class: ReplayClass,
  reason: ReplayReason.optional(),
  errorsSeen: z.array(z.string().max(16_384)).max(1_000),
  finalState: z.unknown(),
  finalProbes: z.record(z.string().max(128), z.union([z.number(), z.string(), z.boolean()])),
  scriptPath: z.string().min(1).max(500),
  durationMs: z.number().int().nonnegative(),
});
export const ReplaySummary = z.strictObject({
  class: ReplayClass,
  reason: ReplayReason.optional(),
  durationMs: z.number().int().nonnegative(),
});
export const RepairTicket = z.strictObject({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(16_000),
  labels: z.array(z.string().min(1).max(100)).max(20),
});
export const EditorHint = z.strictObject({
  controlId: z.string().min(1).max(120),
  suggestion: z.enum(['increase', 'decrease', 'toggle']),
  reason: z.string().min(1).max(240),
});
export const PromiseRef = z.strictObject({
  specPath: z.string().regex(/^promises\/[0-9a-f]{64}\.spec\.ts$/),
  replayPath: z.string().regex(/^promises\/[0-9a-f]{64}\.replay\.json$/),
});
export const PromiseArtifact = z.strictObject({
  ...PromiseRef.shape,
  spec: z.string().min(1).max(8_000),
  replay: z.string().min(1).max(100_000),
});
export const TriageResult = z
  .strictObject({
    reportId: Id,
    replay: ReplaySummary,
    signature: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    diagnosticsKey: z.string().min(1).max(200).optional(),
    ticket: RepairTicket.optional(),
    promise: PromiseRef.optional(),
    editorHint: EditorHint.optional(),
    dedupedInto: Id.optional(),
  })
  .superRefine((value, context) => {
    const error = value.replay.class === 'reproduces_with_error';
    if (!error && (value.ticket || value.promise || value.signature)) {
      context.addIssue({ code: 'custom', message: 'only reproduced errors may carry repair work' });
    }
    if ((value.ticket || value.promise) && (!error || !value.signature)) {
      context.addIssue({ code: 'custom', message: 'repair work requires a reproduced-error signature' });
    }
    if (value.editorHint && (value.ticket || value.promise)) {
      context.addIssue({ code: 'custom', message: 'editor hints cannot carry repair work' });
    }
  });
export const TriageClaim = z.strictObject({
  reportId: Id,
  gameId: Id,
  releaseId: Id.optional(),
  buildHash: z.string().regex(/^[0-9a-f]{64}$/),
  route: z.enum(['game_repair', 'editor_hint']),
  jobId: Id.optional(),
  text: z.string().max(2000).optional(),
  error: ReportError.optional(),
  bundleUrl: z.string().url(),
});
export const CompleteTriage = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('triaged'), result: TriageResult }),
  z.strictObject({
    status: z.literal('stored'),
    reason: z.enum(['bundle_fetch_failed', 'bundle_too_large', 'invalid_bundle', 'replay_failed']),
  }),
]);

export type ReportFrame = z.infer<typeof ReportFrame>;
export type ReportError = z.infer<typeof ReportError>;
export type CreateReport = z.infer<typeof CreateReport>;
export type ReportRoute = z.infer<typeof ReportRoute>;
export type CreateReportResponse = z.infer<typeof CreateReportResponse>;
export type ReplayClass = z.infer<typeof ReplayClass>;
export type ReplayReason = z.infer<typeof ReplayReason>;
export type ReplayResult = z.infer<typeof ReplayResult>;
export type ReplaySummary = z.infer<typeof ReplaySummary>;
export type RepairTicket = z.infer<typeof RepairTicket>;
export type EditorHint = z.infer<typeof EditorHint>;
export type PromiseRef = z.infer<typeof PromiseRef>;
export type PromiseArtifact = z.infer<typeof PromiseArtifact>;
export type TriageResult = z.infer<typeof TriageResult>;
export type TriageClaim = z.infer<typeof TriageClaim>;
export type CompleteTriage = z.infer<typeof CompleteTriage>;

export const reportsSchemas = {
  'reports.create.request.v1': CreateReport,
  'reports.create.response.v1': CreateReportResponse,
  'reports.triage.result.v1': TriageResult,
  'reports.triage.complete.v1': CompleteTriage,
} satisfies Record<string, z.ZodType>;
