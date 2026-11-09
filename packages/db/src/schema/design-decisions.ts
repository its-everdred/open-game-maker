import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { games } from './accounts.js';
import { jobs } from './jobs.js';

// One design decision of a game's New Game design conversation: an aiur Command that got an answer, whether the
// player answered it or the provisional default did. `number` is the game's own sequence, so a decision reads
// `D-01` and later ones read on from it. A later answer is a new row whose `supersedes` names the earlier decision;
// the aiur Command keeps the answer it was given, and this log is what the Executor re-plans from.
export const designDecisions = sqliteTable(
  'design_decisions',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    // The chat job whose Command was answered, and the aiur ticket that Command belongs to when it is linked.
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    ticket: text('ticket'),
    commandId: text('command_id').notNull(),
    decisionId: text('decision_id').notNull(),
    question: text('question').notNull(),
    options: text('options').notNull(),
    recommended: text('recommended'),
    chosen: text('chosen').notNull(),
    origin: text('origin', { enum: ['player', 'default'] }).notNull(),
    skipped: integer('skipped', { mode: 'boolean' }).notNull().default(false),
    affects: text('affects').notNull(),
    supersedes: integer('supersedes'),
    at: text('at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.number] }),
    index('design_decisions_game_command').on(table.gameId, table.commandId),
    check('design_decisions_number', sql`${table.number} > 0`),
    check('design_decisions_origin', sql`${table.origin} IN ('player', 'default')`),
    check('design_decisions_skipped', sql`${table.skipped} IN (0, 1)`),
    check('design_decisions_supersedes', sql`${table.supersedes} IS NULL OR ${table.supersedes} > 0`),
  ],
);
