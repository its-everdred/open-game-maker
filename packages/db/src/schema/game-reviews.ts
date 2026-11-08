import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { games } from './accounts.js';

// A review's short number inside its game (#591): `/<slug>/review/<n>`. Each aiur decision shown for a game gets the
// next number the first time it is shown; the decision itself stays in aiur. Rows are never deleted while the game
// lives, so a number is never handed to a second decision.
export const gameReviews = sqliteTable(
  'game_reviews',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    decisionId: text('decision_id').notNull(),
    number: integer('number').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.decisionId] }),
    uniqueIndex('game_reviews_game_number_unique').on(table.gameId, table.number),
  ],
);
