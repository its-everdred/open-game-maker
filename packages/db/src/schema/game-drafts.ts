import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { families, games } from './accounts.js';

// A new-game form stays outside `games` until Finish. The shared scope assistant ticket is transient too;
// promotion is the only operation that attaches the draft to a real game.
export const gameDrafts = sqliteTable(
  'game_drafts',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    creatorId: text('creator_id').notNull(),
    choices: text('choices').notNull(),
    allowAiGeneratedAssets: integer('allow_ai_generated_assets', { mode: 'boolean' }).notNull().default(true),
    ticketRepo: text('ticket_repo'),
    ticketNumber: integer('ticket_number'),
    status: text('status', { enum: ['open', 'agreed', 'abandoned', 'promoted'] }).notNull(),
    revision: integer('revision').notNull().default(0),
    scope: text('scope'),
    scopeHash: text('scope_hash'),
    gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    index('game_drafts_expiry').on(table.expiresAt),
    index('game_drafts_owner').on(table.creatorId, table.status),
    check('game_drafts_status', sql`${table.status} IN ('open', 'agreed', 'abandoned', 'promoted')`),
    check('game_drafts_revision', sql`${table.revision} >= 0`),
    check(
      'game_drafts_scope_payload',
      sql`(${table.scope} IS NULL AND ${table.scopeHash} IS NULL) OR (${table.scope} IS NOT NULL AND ${table.scopeHash} IS NOT NULL AND ${table.status} IN ('agreed', 'promoted'))`,
    ),
    check(
      'game_drafts_ticket_pair',
      sql`${table.ticketNumber} IS NULL OR ${table.ticketRepo} IS NOT NULL`,
    ),
  ],
);
