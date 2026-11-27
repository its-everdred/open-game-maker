import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { jobs } from './jobs.js';

// Durable checkpoints for the GitHub -> spend cap -> agent:todo filing sequence.
export const jobTickets = sqliteTable(
  'job_tickets',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    issueNumber: integer('issue_number').notNull(),
    repo: text('repo').notNull(),
    sig: text('sig').notNull(),
    capSetAt: text('cap_set_at'),
    todoAt: text('todo_at'),
    filedAt: text('filed_at'),
    terminalState: text('terminal_state', { enum: ['done', 'cancelled'] }),
    lifecycleSeq: integer('lifecycle_seq'),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.key] }),
    uniqueIndex('job_tickets_repo_issue').on(table.repo, table.issueNumber),
    check('job_tickets_issue_number', sql`${table.issueNumber} > 0`),
  ],
);
