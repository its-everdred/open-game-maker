import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// OGM-080: one append-only conversation per job; `seq` is the stream cursor (`?since=`, SSE `id:`).
// Media columns hold blob hashes; URLs are minted at read time.
export const buildChatMessages = sqliteTable(
  'build_chat_messages',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull(),
    jobId: text('job_id').notNull(),
    at: text('at').notNull(),
    actor: text('actor', { enum: ['creator', 'agent', 'system'] }).notNull(),
    kind: text('kind', { enum: ['text', 'image', 'clip', 'command', 'progress'] }).notNull(),
    text: text('text'),
    mediaHash: text('media_hash'),
    posterHash: text('poster_hash'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    commandJson: text('command_json'),
    aiurTicket: text('aiur_ticket'),
    aiurEventId: integer('aiur_event_id'),
    aiurTopic: text('aiur_topic'),
    mirrorState: text('mirror_state', { enum: ['pending', 'sent', 'failed'] }),
  },
  (table) => [
    uniqueIndex('build_chat_messages_id_unique').on(table.id),
    uniqueIndex('build_chat_messages_job_event_unique').on(table.jobId, table.aiurEventId),
    index('build_chat_messages_job_seq').on(table.jobId, table.seq),
    check('build_chat_messages_actor', sql`${table.actor} IN ('creator', 'agent', 'system')`),
    check('build_chat_messages_kind', sql`${table.kind} IN ('text', 'image', 'clip', 'command', 'progress')`),
  ],
);

// Relay state: the byte offset read so far in each outbox file, and the job each workspace is pinned to.
export const buildChatOutboxOffsets = sqliteTable('build_chat_outbox_offsets', {
  path: text('path').primaryKey(),
  offset: integer('offset').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const buildChatWorkspaces = sqliteTable(
  'build_chat_workspaces',
  {
    workspaceRoot: text('workspace_root').primaryKey(),
    jobId: text('job_id').notNull(),
    pinnedAt: text('pinned_at').notNull(),
  },
  (table) => [index('build_chat_workspaces_job').on(table.jobId)],
);

// #222: files a creator uploads for a chat message. `message_id` stays null until a post claims the upload; text files
// keep their bytes in the blob store like images, so the row holds only metadata.
export const buildChatAttachments = sqliteTable(
  'build_chat_attachments',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull(),
    creatorId: text('creator_id').notNull(),
    messageId: text('message_id'),
    kind: text('kind', { enum: ['image', 'text'] }).notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    blobHash: text('blob_hash').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('build_chat_attachments_job').on(table.jobId, table.createdAt),
    index('build_chat_attachments_message').on(table.messageId),
    check('build_chat_attachments_kind', sql`${table.kind} IN ('image', 'text')`),
  ],
);
