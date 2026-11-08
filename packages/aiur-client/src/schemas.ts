import { z, type ZodType } from 'zod';

import { AiurContractError } from './errors.js';

const DecimalStringSchema = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/);
const MoneySchema = z.record(z.string(), DecimalStringSchema);
const CoverageSchema = z
  .object({
    status: z.string(),
    known: z.number().int().nonnegative().optional(),
    unknown: z.number().int().nonnegative().optional(),
    reasons: z.array(z.string()).optional(),
  })
  .loose();
const ApiEquivalentSchema = z
  .object({
    amount: MoneySchema,
    coverage: CoverageSchema,
  })
  .loose();
const UsageMeasureSchema = z
  .object({
    tokens: z.number().int().nonnegative(),
    provider_reported: MoneySchema,
    api_equivalent: ApiEquivalentSchema,
  })
  .loose();

export const TicketUsageSchema = z
  .object({
    contract: z.literal('aiur.ticket_usage'),
    contract_version: z.literal(1),
    schema_version: z.number().int().positive(),
    ticket: z
      .object({
        owner: z.string(),
        repository: z.string(),
        identifier: z.string(),
      })
      .loose(),
    currency: z.literal('USD'),
    state: z.string(),
    authority: z.record(z.string(), z.unknown()),
    freshness: z.record(z.string(), z.unknown()),
    totals: UsageMeasureSchema,
    by_model: z.array(UsageMeasureSchema.extend({ model: z.string() }).loose()),
    by_provider: z.array(
      UsageMeasureSchema.extend({
        provider: z.string(),
        upstream_provider: z.string().nullable().optional(),
      }).loose(),
    ),
    sessions: z.array(
      UsageMeasureSchema.extend({
        run_id: z.string(),
        by_model: z.array(z.record(z.string(), z.unknown())),
        by_provider: z.array(z.record(z.string(), z.unknown())),
      }).loose(),
    ),
  })
  .loose();

const PhaseReadingSchema = z
  .object({
    status: z.enum(['known', 'unknown']),
    value: z.enum(['brainstorm', 'plan', 'work', 'review']).nullable().optional(),
    observed_at: z.string().optional(),
  })
  .loose();
const ProgressReadingSchema = z
  .object({
    status: z.enum(['known', 'unknown']),
    percent: z.number().min(0).max(100).optional(),
    source: z.string().optional(),
    freshness: z.string().optional(),
    occurred_at: z.string().optional(),
    observed_at: z.string().optional(),
  })
  .loose();

export const TicketProgressSchema = z
  .object({
    contract: z.literal('aiur.ticket_progress'),
    contract_version: z.literal(1),
    issue_identifier: z.string(),
    repository: z.string().nullable(),
    phase: PhaseReadingSchema,
    progress: ProgressReadingSchema,
    events: z.array(z.record(z.string(), z.unknown())),
    sources: z.object({ activity: z.enum(['available', 'unavailable']) }).loose(),
    generated_at: z.string(),
  })
  .loose();

export const UsageAccountsSchema = z
  .object({
    contract: z.literal('aiur.usage.accounts'),
    contract_version: z.literal(1),
    observed_at: z.string(),
    accounts: z.array(
      z
        .object({
          name: z.string(),
          harness: z.string(),
          weekly_percent: z.number().nullable().optional(),
          five_hour_percent: z.number().nullable().optional(),
          remaining_percent: z.number().nullable().optional(),
          freshness: z.string(),
        })
        .loose(),
    ),
  })
  .loose();

export const IssueEntrySchema = z
  .object({
    contract: z.literal('aiur.ticket'),
    contract_version: z.literal(1),
    issue_identifier: z.string(),
    issue_id: z.string(),
    status: z.string(),
    workspace: z.record(z.string(), z.unknown()),
    attempts: z.record(z.string(), z.unknown()),
    running: z.record(z.string(), z.unknown()).nullable(),
    retry: z.record(z.string(), z.unknown()).nullable(),
    queue: z.record(z.string(), z.unknown()),
  })
  .loose();

export const StateSchema = z
  .object({
    contract: z.literal('aiur.status'),
    contract_version: z.literal(1),
    generated_at: z.string(),
    counts: z
      .object({
        running: z.number().int().nonnegative(),
        retrying: z.number().int().nonnegative(),
        idle: z.number().int().nonnegative(),
      })
      .loose(),
    running: z.array(z.record(z.string(), z.unknown())),
    retrying: z.array(z.record(z.string(), z.unknown())),
    idle: z.array(z.record(z.string(), z.unknown())),
  })
  .loose();

export const SpendCapSchema = z
  .object({
    contract: z.literal('aiur.ticket_spend_cap'),
    contract_version: z.literal(1),
    schema_version: z.number().int().positive(),
    job_id: z.string(),
    ticket: z.object({ owner: z.string(), repository: z.string(), identifier: z.string() }).loose(),
    currency: z.literal('USD'),
    cap_amount: DecimalStringSchema,
    spent_amount: DecimalStringSchema.nullable(),
    remaining_amount: DecimalStringSchema.nullable(),
    state: z.enum(['active', 'unavailable', 'budget_exhausted']),
    end_state: z.literal('budget_exhausted').nullable(),
    coverage: z.record(z.string(), z.unknown()),
    authority: z.record(z.string(), z.unknown()),
    configured_at: z.string(),
    reached_at: z.string().nullable(),
    effects: z.record(z.string(), z.unknown()),
  })
  .loose();

export const CancelResultSchema = z
  .object({
    process: z
      .object({
        status: z.enum(['exited', 'still_running', 'kill_failed', 'generation_changed']),
      })
      .loose(),
  })
  .loose();

export const MessageResultSchema = z
  .object({
    request_id: z.string().nullable().optional(),
    outcome: z.literal('unknown').optional(),
    retry_safe: z.boolean().optional(),
  })
  .loose();

export const ControlResultSchema = z
  .object({
    contract: z.literal('aiur.control.result'),
    contract_version: z.literal(1),
    instance_id: z.string(),
    build: z.record(z.string(), z.unknown()),
    output: z.unknown(),
    elapsed_ms: z.number().nonnegative(),
  })
  .loose();

export const EventsTokenSchema = z
  .object({
    token: z.string().min(1),
    expires_in_seconds: z.number().int().positive(),
  })
  .loose();

const ExportedEventWireSchema = z
  .object({
    type: z.literal('event'),
    seq: z.number().int().positive(),
    v: z.literal(1),
    instance: z.string().min(1),
    id: z.number().int().positive(),
    topic: z.string(),
    class: z.enum(['ephemeral', 'live', 'ledgered', 'logged', 'journaled']),
    occurred_at: z.string().nullable(),
    observed_at: z.string(),
    source: z.string(),
    refs: z.record(z.string(), z.unknown()),
    attrs: z.record(z.string(), z.unknown()),
    payload_version: z.number().int().positive(),
    anchor: z.null(),
  })
  .loose();
export const ExportedEventSchema = ExportedEventWireSchema.transform((record) => ({
  ...record,
  payload: record.attrs,
}));
export const GapRecordSchema = z
  .object({
    type: z.literal('gap'),
    seq: z.number().int().positive(),
    scope: z.literal('*'),
    reason: z.literal('exporter_start'),
    from: z.string().nullable(),
    to: z.string(),
  })
  .loose();
export const ResetRecordSchema = z
  .object({
    type: z.literal('reset'),
    oldest_seq: z.number().int().nonnegative(),
    head_seq: z.number().int().nonnegative(),
    epoch: z.string().optional(),
  })
  .loose();
export const EventErrorRecordSchema = z.object({ type: z.literal('error'), code: z.string() }).loose();
export const AuthExpiringRecordSchema = z
  .object({ type: z.literal('auth_expiring'), in_ms: z.number().int().nonnegative() })
  .loose();
export const EventRecordSchema = z.union([
  ExportedEventSchema,
  GapRecordSchema,
  ResetRecordSchema,
  EventErrorRecordSchema,
  AuthExpiringRecordSchema,
]);
export const EventPageSchema = z
  .object({
    records: z.array(EventRecordSchema),
    oldest_seq: z.number().int().nonnegative(),
    head_seq: z.number().int().nonnegative(),
    epoch: z.string(),
    instance: z.string(),
  })
  .loose();

const DecisionAnswerSchema = z
  .object({
    selected_option_id: z.string().nullable().optional(),
    option_id: z.string().nullable().optional(),
    option: z.string().nullable().optional(),
    custom_response: z.string().nullable().optional(),
  })
  .loose()
  .nullable()
  .optional();

// One media item on a Command's prompt or option, in aiur's public projection: a local file is an `attachment` locator
// fetched through the decision media route, a vetted https file a `url` locator. Every field is lenient so one odd item
// never fails the whole decision list; callers check what they render.
const DecisionMediaLocatorSchema = z
  .object({ kind: z.string(), attachment_id: z.string().optional(), value: z.string().optional() })
  .loose();
export const DecisionMediaSchema = z
  .object({
    kind: z.string().nullable().optional(),
    mime_type: z.string().nullable().optional(),
    attachment_id: z.string().nullable().optional(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    duration_ms: z.number().nullable().optional(),
    locator: DecisionMediaLocatorSchema.nullable().optional(),
    poster: DecisionMediaLocatorSchema.nullable().optional(),
  })
  .loose();

export const DecisionSchema = z
  .object({
    decision_id: z.string(),
    version: z.number().int().positive(),
    ticket: z.object({ identifier: z.string() }).loose(),
    kind: z.string().nullable(),
    authority: z.string(),
    blocking: z.boolean(),
    reversibility: z.enum(['reversible', 'partially_reversible', 'irreversible']),
    question: z.string(),
    options: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          description: z.string().nullable().optional(),
          media: z.array(DecisionMediaSchema).nullable().optional(),
        })
        .loose(),
    ),
    recommendation: z
      .object({ option_id: z.string().nullable().optional(), reason: z.string().nullable().optional() })
      .loose()
      .nullable()
      .optional(),
    context: z
      .object({
        short_summary: z.string().nullable().optional(),
        long_context_markdown: z.string().nullable().optional(),
      })
      .loose()
      .optional(),
    questions: z.array(z.object({ multi_select: z.boolean().optional() }).loose()).optional(),
    answer: DecisionAnswerSchema,
    active_answer: DecisionAnswerSchema,
    created_at: z.string(),
    decision_status: z.string(),
  })
  .loose();
export const DecisionPageSchema = z.object({ decisions: z.array(DecisionSchema) }).loose();
export const DecisionMutationSchema = z.object({ status: z.string(), decision: DecisionSchema }).loose();

const expectedContracts = new Map<ZodType, string>([
  [TicketUsageSchema, 'aiur.ticket_usage v1'],
  [TicketProgressSchema, 'aiur.ticket_progress v1'],
  [UsageAccountsSchema, 'aiur.usage.accounts v1'],
  [IssueEntrySchema, 'aiur.ticket v1'],
  [StateSchema, 'aiur.status v1'],
  [SpendCapSchema, 'aiur.ticket_spend_cap v1'],
  [ControlResultSchema, 'aiur.control.result v1'],
]);

export function parseContract<T extends ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const contract = typeof record.contract === 'string' ? record.contract : 'unknown contract';
  const version = record.contract_version;
  const expected = expectedContracts.get(schema) ?? 'valid aiur contract';
  const received = version === undefined ? contract : `${contract} v${String(version)}`;

  throw new AiurContractError(expected, received, parsed.error.message);
}

export type TicketUsage = z.infer<typeof TicketUsageSchema>;
export type TicketProgress = z.infer<typeof TicketProgressSchema>;
export type UsageAccounts = z.infer<typeof UsageAccountsSchema>;
export type IssueEntry = z.infer<typeof IssueEntrySchema>;
export type AiurState = z.infer<typeof StateSchema>;
export type SpendCap = z.infer<typeof SpendCapSchema>;
export type CancelResult = z.infer<typeof CancelResultSchema>;
export type ControlResult = z.infer<typeof ControlResultSchema>;
export type EventRecord = z.infer<typeof EventRecordSchema>;
export type ExportedEvent = z.infer<typeof ExportedEventSchema>;
export type GapRecord = z.infer<typeof GapRecordSchema>;
export type ResetRecord = z.infer<typeof ResetRecordSchema>;
export type EventPage = z.infer<typeof EventPageSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type DecisionMedia = z.infer<typeof DecisionMediaSchema>;
