import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// The instance sign-in allow list: one row per admitted address (stored lowercase) and the role it
// grants. `added_by` is the admin's user id, or `env` for a row seeded from `OGM_ALLOWED_EMAILS` /
// `OGM_MAINTAINER_EMAILS` on first start. Emails are only stable keys; a row exists before its
// address ever signs in, so there is no foreign key to `user`.
export const allowedUsers = sqliteTable(
  'allowed_users',
  {
    email: text('email').primaryKey(),
    role: text('role', { enum: ['player', 'maker', 'admin'] }).notNull(),
    addedBy: text('added_by').notNull(),
    addedAt: text('added_at').notNull(),
  },
  (table) => [
    index('allowed_users_added_at_index').on(table.addedAt),
    check('allowed_users_role_check', sql`${table.role} IN ('player', 'maker', 'admin')`),
  ],
);

// Limits are keyed by address so an administrator can configure an invite before first sign-in.
// Null means unlimited. An absent row uses the instance defaults.
export const weeklyJobBudgets = sqliteTable(
  'weekly_job_budgets',
  {
    email: text('email')
      .primaryKey()
      .references(() => allowedUsers.email, { onDelete: 'cascade' }),
    newGames: integer('new_games'),
    edits: integer('edits'),
  },
  (table) => [
    check(
      'weekly_job_budgets_values',
      sql`(${table.newGames} IS NULL OR ${table.newGames} >= 0) AND (${table.edits} IS NULL OR ${table.edits} >= 0)`,
    ),
  ],
);
