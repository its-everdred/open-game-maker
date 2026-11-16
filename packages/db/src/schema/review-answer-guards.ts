import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// A verdict suppresses a missing-review request until the tracker observes the ticket leave review.
export const reviewAnswerGuards = sqliteTable(
  'review_answer_guards',
  {
    source: text('source').notNull(),
    ticket: text('ticket').notNull(),
    episode: text('episode'),
    observedReview: integer('observed_review', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.source, table.ticket] })],
);
