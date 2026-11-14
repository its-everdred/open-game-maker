import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { games } from './accounts.js';

// A round is never replaced by the next submission. Its verdict and the action that consumed it stay with the round.
export const reviewRounds = sqliteTable(
  'review_rounds',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    track: text('track').notNull(),
    phase: text('phase').notNull(),
    category: text('category', { enum: ['art', 'gameplay', 'sound'] }).notNull(),
    round: integer('round').notNull(),
    ticket: text('ticket').notNull(),
    prNumber: integer('pr_number'),
    sha: text('sha').notNull(),
    media: text('media').notNull(),
    question: text('question'),
    postedAt: text('posted_at').notNull(),
    verdict: text('verdict', { enum: ['approved', 'needs_work', 'kill'] }),
    notes: text('notes'),
    verdictAt: text('verdict_at'),
    verdictSource: text('verdict_source', { enum: ['preview', 'command', 'comment'] }),
    consumedByRun: text('consumed_by_run'),
    consumedAt: text('consumed_at'),
    remindedAt: text('reminded_at'),
  },
  (table) => [
    uniqueIndex('review_rounds_phase_round').on(table.gameId, table.track, table.phase, table.round),
    index('review_rounds_ticket').on(table.gameId, table.ticket),
    check('review_rounds_positive_round', sql`${table.round} > 0`),
    check('review_rounds_media_array', sql`json_type(${table.media}) = 'array'`),
    check(
      'review_rounds_verdict',
      sql`${table.verdict} IS NULL OR ${table.verdict} IN ('approved', 'needs_work', 'kill')`,
    ),
    check(
      'review_rounds_verdict_source',
      sql`${table.verdictSource} IS NULL OR ${table.verdictSource} IN ('preview', 'command', 'comment')`,
    ),
    check(
      'review_rounds_answer_consistent',
      sql`(${table.verdict} IS NULL AND ${table.verdictAt} IS NULL AND ${table.verdictSource} IS NULL) OR (${table.verdict} IS NOT NULL AND ${table.verdictAt} IS NOT NULL AND ${table.verdictSource} IS NOT NULL)`,
    ),
    check(
      'review_rounds_consumed_consistent',
      sql`(${table.consumedByRun} IS NULL AND ${table.consumedAt} IS NULL) OR (${table.consumedByRun} IS NOT NULL AND ${table.consumedAt} IS NOT NULL)`,
    ),
  ],
);
