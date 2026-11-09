import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { games } from './accounts.js';
import { jobs } from './jobs.js';

// The game's review ledger (A3): one row per review-deck answer. A review Command's options carry media, the creator
// likes or dislikes each card, and a dislike may carry their words. The row keeps what the Command asked and every
// card's label, so the reasons survive the Command, the session and the signed media URLs (#567 reads this to build
// the game's design/feedback.json).
export const commandReviews = sqliteTable(
  'command_reviews',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    // The job that owns the Command; null when no job does — a registered game reads its own aiur instance's open
    // Commands (#573), so its review still lands in the ledger without a job to point at.
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    // The aiur ticket the Command belongs to; null until the job is linked to one.
    ticket: text('ticket'),
    title: text('title').notNull(),
    commandId: text('command_id').notNull(),
    decisionId: text('decision_id').notNull(),
    question: text('question').notNull(),
    // The option the Command was answered with: the tapped shortlist card, or the first like when it asks for many.
    optionId: text('option_id').notNull(),
    likes: text('likes').notNull(),
    dislikes: text('dislikes').notNull(),
    // The creator's words about the whole set, beside the per-card reasons; null when they said nothing extra.
    notes: text('notes'),
    at: text('at').notNull(),
  },
  (table) => [
    index('command_reviews_game_at').on(table.gameId, table.at),
    index('command_reviews_command').on(table.commandId),
    check('command_reviews_likes_array', sql`json_type(${table.likes}) = 'array'`),
    check('command_reviews_dislikes_array', sql`json_type(${table.dislikes}) = 'array'`),
  ],
);
