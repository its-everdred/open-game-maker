import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// OGM-032: every aiur feed record as received, idempotent on (daemon_slug, seq).
export const aiurEvents = sqliteTable(
  'aiur_events',
  {
    daemonSlug: text('daemon_slug').notNull(),
    seq: integer('seq').notNull(),
    topic: text('topic').notNull(),
    ticket: text('ticket'),
    jobId: text('job_id'),
    payload: text('payload').notNull(),
    observedAt: text('observed_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.daemonSlug, table.seq] }),
    index('aiur_events_job_seq').on(table.jobId, table.seq),
  ],
);

export const aiurCursors = sqliteTable('aiur_cursors', {
  daemonSlug: text('daemon_slug').primaryKey(),
  lastSeq: integer('last_seq').notNull(),
  epoch: text('epoch'),
  updatedAt: text('updated_at').notNull(),
});

// aiur Commands for a job, polled from `/decisions`; OGM-082 renders and answers them.
export const commands = sqliteTable(
  'commands',
  {
    decisionId: text('decision_id').primaryKey(),
    jobId: text('job_id').notNull(),
    daemonSlug: text('daemon_slug').notNull(),
    version: integer('version').notNull(),
    question: text('question').notNull(),
    options: text('options').notNull(),
    recommend: text('recommend'),
    status: text('status', { enum: ['open', 'answered', 'moot'] }).notNull(),
    openedAt: text('opened_at').notNull(),
    answeredAt: text('answered_at'),
  },
  (table) => [
    check('commands_status', sql`${table.status} IN ('open', 'answered', 'moot')`),
    index('commands_job').on(table.jobId),
  ],
);

// The job's projected stage and the aiur inputs it was computed from. Keyed by job id, joined to OGM-013's jobs.
export const jobProjections = sqliteTable('job_projections', {
  jobId: text('job_id').primaryKey(),
  daemonSlug: text('daemon_slug').notNull(),
  ticket: text('ticket').notNull(),
  stage: text('stage').notNull(),
  stageText: text('stage_text').notNull(),
  phase: text('phase'),
  progressPercent: integer('progress_percent'),
  lastEventSeq: integer('last_event_seq'),
  aiurRunId: text('aiur_run_id'),
  lifecycle: text('lifecycle'),
  trackerState: text('tracker_state'),
  reasonLabels: text('reason_labels').notNull().default('[]'),
  spendCapReached: integer('spend_cap_reached', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
});
