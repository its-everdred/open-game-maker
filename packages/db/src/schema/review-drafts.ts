import { sql } from 'drizzle-orm';
import { check, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { games } from './accounts.js';

// A review deck's votes as the creator casts them (#631): each vote is saved here as it happens, so leaving midway, a
// reload or another device keeps the votes, and the Command is answered once every card has one. One row per creator,
// game and question; `draft_key` is the Command's checkpoint id and version, so a reopened Command starts clean.
export const reviewDrafts = sqliteTable(
  'review_drafts',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    draftKey: text('draft_key').notNull(),
    // The deck as JSON: `{ cards: [{ option_id, verdict, reason? }] }`.
    deck: text('deck').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.userId, table.draftKey] }),
    check('review_drafts_deck_object', sql`json_type(${table.deck}) = 'object'`),
  ],
);
