import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { reviewRounds } from './review-rounds.js';

// Created before a remote rework call and retained until its matching worker run is observed.
export const reviewDispatchIntents = sqliteTable('review_dispatch_intents', {
  roundId: text('round_id')
    .primaryKey()
    .references(() => reviewRounds.id, { onDelete: 'cascade' }),
  ticket: text('ticket').notNull(),
  state: text('state', { enum: ['dispatching', 'consumed'] }).notNull(),
  createdAt: text('created_at').notNull(),
  runId: text('run_id'),
});
