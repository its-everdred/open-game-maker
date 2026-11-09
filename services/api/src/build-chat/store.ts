import { randomUUID } from 'node:crypto';

import type { BlobHash } from '@ogm/blob-store';
import { BuildChatMessage, type ChatAttachment, type ChatCommand } from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';

export type ChatActor = BuildChatMessage['actor'];
export type ChatKind = BuildChatMessage['kind'];
export type MirrorState = 'pending' | 'sent' | 'failed';

export type ChatRow = {
  seq: number;
  id: string;
  jobId: string;
  at: string;
  actor: ChatActor;
  kind: ChatKind;
  text: string | null;
  mediaHash: BlobHash | null;
  posterHash: BlobHash | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  commandJson: string | null;
  aiurTicket: string | null;
  aiurEventId: number | null;
  aiurTopic: string | null;
  mirrorState: MirrorState | null;
};

export type StoredMedia = { hash: BlobHash; posterHash?: BlobHash; width: number; height: number; durationMs?: number };

export type NewChatRow = {
  id?: string;
  jobId: string;
  at?: string;
  actor: ChatActor;
  kind: ChatKind;
  text?: string;
  media?: StoredMedia;
  command?: StoredCommand;
  aiur?: { ticket: string; eventId?: number; topic?: string };
  mirrorState?: MirrorState;
};

export type StoredCommand = ChatCommand & {
  command_id?: string;
  version?: number;
  // A decision mirrored from aiur: who it is for, and its short topic (see commands/audience.ts).
  audience?: 'creator';
  summary?: string;
  // A creator's change to a non-design Command after aiur took its answer (#597): the answer that now stands and how
  // many changes there were. Kept apart from `option_id`, which the poller keeps equal to aiur's answer.
  corrected_option_id?: string;
  corrections?: number;
};

// Mints a short-lived URL for a blob hash (the blob store's signed GET).
export type MediaSigner = (hash: BlobHash) => Promise<string>;

const columns = `
  seq, id, job_id AS jobId, at, actor, kind, text,
  media_hash AS mediaHash, poster_hash AS posterHash, width, height, duration_ms AS durationMs,
  command_json AS commandJson, aiur_ticket AS aiurTicket, aiur_event_id AS aiurEventId,
  aiur_topic AS aiurTopic, mirror_state AS mirrorState
`;

export function newMessageId(): string {
  return `m_${randomUUID()}`;
}

// Append-only. A duplicate `id` or a duplicate `(job, aiur event id)` is ignored: `inserted` is false and `row` is the
// row already stored under that id (or null when only the event id collided).
export function insertChatRow(sqlite: Sqlite, input: NewChatRow): { row: ChatRow | null; inserted: boolean } {
  const id = input.id ?? newMessageId();
  const result = sqlite
    .prepare(
      `INSERT INTO build_chat_messages
       (id, job_id, at, actor, kind, text, media_hash, poster_hash, width, height, duration_ms,
        command_json, aiur_ticket, aiur_event_id, aiur_topic, mirror_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(
      id,
      input.jobId,
      input.at ?? new Date().toISOString(),
      input.actor,
      input.kind,
      input.text ?? null,
      input.media?.hash ?? null,
      input.media?.posterHash ?? null,
      input.media?.width ?? null,
      input.media?.height ?? null,
      input.media?.durationMs ?? null,
      input.command === undefined ? null : JSON.stringify(input.command),
      input.aiur?.ticket ?? null,
      input.aiur?.eventId ?? null,
      input.aiur?.topic ?? null,
      input.mirrorState ?? null,
    );
  return { row: getChatRow(sqlite, id), inserted: result.changes > 0 };
}

export function getChatRow(sqlite: Sqlite, id: string): ChatRow | null {
  return (sqlite.prepare(`SELECT ${columns} FROM build_chat_messages WHERE id = ?`).get(id) as ChatRow) ?? null;
}

export function parseCommand(row: ChatRow): StoredCommand | null {
  return row.commandJson === null ? null : (JSON.parse(row.commandJson) as StoredCommand);
}

export function listCommands(sqlite: Sqlite, jobId: string): ChatRow[] {
  return sqlite
    .prepare(`SELECT ${columns} FROM build_chat_messages WHERE job_id = ? AND kind = 'command' ORDER BY seq ASC`)
    .all(jobId) as ChatRow[];
}

export function findCommand(sqlite: Sqlite, jobId: string, identifier: string): ChatRow | null {
  return (
    listCommands(sqlite, jobId).find((row) => {
      const command = parseCommand(row);
      return row.id === identifier || command?.command_id === identifier || command?.decision_id === identifier;
    }) ?? null
  );
}

export function listSince(sqlite: Sqlite, jobId: string, since: number, limit = 200): ChatRow[] {
  return sqlite
    .prepare(`SELECT ${columns} FROM build_chat_messages WHERE job_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`)
    .all(jobId, since, limit) as ChatRow[];
}

export function markMirror(sqlite: Sqlite, id: string, state: MirrorState): void {
  sqlite.prepare('UPDATE build_chat_messages SET mirror_state = ? WHERE id = ?').run(state, id);
}

export function pendingMirrors(sqlite: Sqlite, jobId: string): ChatRow[] {
  return sqlite
    .prepare(`SELECT ${columns} FROM build_chat_messages WHERE job_id = ? AND mirror_state = 'pending' ORDER BY seq`)
    .all(jobId) as ChatRow[];
}

// The text of the job's latest aiur phase row, so a restart does not repeat it.
export function lastPhase(sqlite: Sqlite, jobId: string): string | null {
  const row = sqlite
    .prepare(`SELECT text FROM build_chat_messages WHERE job_id = ? AND aiur_topic = 'phase' ORDER BY seq DESC LIMIT 1`)
    .get(jobId) as { text: string | null } | undefined;
  return row?.text ?? null;
}

// OGM-082 correlates and answers commands. The row moves to the end of the job's sequence so `since` readers and
// the stream deliver it again; clients replace a row whose id they already hold.
export function updateCommand(sqlite: Sqlite, id: string, patch: Partial<StoredCommand>): ChatRow | null {
  return sqlite.transaction(() => {
    const row = getChatRow(sqlite, id);
    if (row?.commandJson == null) return null;
    const command = { ...(JSON.parse(row.commandJson) as StoredCommand), ...patch };
    const { next } = sqlite.prepare('SELECT max(seq) + 1 AS next FROM build_chat_messages').get() as { next: number };
    sqlite
      .prepare('UPDATE build_chat_messages SET command_json = ?, seq = ? WHERE id = ?')
      .run(JSON.stringify(command), next, id);
    sqlite.prepare("UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = 'build_chat_messages'").run(next);
    return getChatRow(sqlite, id);
  })();
}

export async function toMessage(
  row: ChatRow,
  sign: MediaSigner,
  attachments: ChatAttachment[] = [],
): Promise<BuildChatMessage> {
  const media =
    row.mediaHash === null || row.width === null || row.height === null
      ? undefined
      : {
          url: await sign(row.mediaHash),
          ...(row.posterHash === null ? {} : { poster: await sign(row.posterHash) }),
          width: row.width,
          height: row.height,
          ...(row.durationMs === null ? {} : { duration_ms: row.durationMs }),
        };
  return BuildChatMessage.parse({
    id: row.id,
    job_id: row.jobId,
    at: row.at,
    actor: row.actor,
    kind: row.kind,
    ...(row.text === null ? {} : { text: row.text }),
    ...(media === undefined ? {} : { media }),
    ...(row.commandJson === null ? {} : { command: JSON.parse(row.commandJson) as unknown }),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(row.aiurTicket === null
      ? {}
      : {
          aiur: {
            ticket: row.aiurTicket,
            ...(row.aiurEventId === null ? {} : { event_id: row.aiurEventId }),
            ...(row.aiurTopic === null ? {} : { topic: row.aiurTopic }),
          },
        }),
  });
}
