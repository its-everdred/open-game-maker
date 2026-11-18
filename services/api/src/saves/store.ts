import { createHash } from 'node:crypto';

import type { SaveRevision, SaveSlot } from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';

import { assertPlayLease } from './lease.js';

export type SaveSlotId = SaveSlot['slotId'];
export type SaveReason = SaveRevision['reason'];

export type PutSaveRevisionInput = {
  userId: string;
  gameId: string;
  slotId: SaveSlotId;
  ifMatch: number;
  payload: Uint8Array;
  branchId: string;
  buildId: string;
  releaseId?: string;
  saveSchemaVersion: number;
  deviceId: string;
  clientSeq: number;
  reason: SaveReason;
  label?: string;
  migratedFromRevision?: number;
  now?: Date;
};

type RevisionRow = {
  user_id: string;
  game_id: string;
  slot_id: string;
  revision: number;
  branch_id: string;
  build_id: string;
  release_id: string | null;
  save_schema_version: number;
  payload: Buffer;
  sha256: string;
  device_id: string;
  client_seq: number;
  reason: SaveReason;
  migrated_from_revision: number | null;
  created_at: string;
};

export type StoredSaveSlot = {
  userId: string;
  gameId: string;
  slotId: SaveSlotId;
  kind: SaveSlot['kind'];
  label?: string;
  headRevision: number;
  headSchema: number;
  savedAt: string;
};

export class StaleRevision extends Error {
  constructor(readonly headRevision: number) {
    super(`stale save revision; slot head is ${headRevision}`);
    this.name = 'StaleRevision';
  }
}

export class SaveNotFound extends Error {
  constructor() {
    super('save revision not found');
    this.name = 'SaveNotFound';
  }
}

function revisionFromRow(row: RevisionRow): SaveRevision {
  return {
    userId: row.user_id,
    gameId: row.game_id,
    slotId: row.slot_id,
    revision: row.revision,
    branchId: row.branch_id,
    buildId: row.build_id,
    releaseId: row.release_id ?? undefined,
    saveSchemaVersion: row.save_schema_version,
    payload: new Uint8Array(row.payload),
    sha256: row.sha256,
    deviceId: row.device_id,
    clientSeq: row.client_seq,
    reason: row.reason,
    migratedFromRevision: row.migrated_from_revision ?? undefined,
    createdAt: row.created_at,
  };
}

export function putSaveRevision(sqlite: Sqlite, input: PutSaveRevisionInput): { revision: number; replayed: boolean } {
  const now = input.now ?? new Date();
  return sqlite
    .transaction(() => {
      assertPlayLease(sqlite, {
        userId: input.userId,
        gameId: input.gameId,
        deviceId: input.deviceId,
        now,
      });
      const replay = sqlite
        .prepare<[string, string, SaveSlotId, string, number], { revision: number }>(
          `SELECT revision FROM save_revisions
           WHERE user_id = ? AND game_id = ? AND slot_id = ? AND device_id = ? AND client_seq = ?`,
        )
        .get(input.userId, input.gameId, input.slotId, input.deviceId, input.clientSeq);
      if (replay) return { revision: replay.revision, replayed: true };

      sqlite
        .prepare(
          `INSERT OR IGNORE INTO save_slots (user_id, game_id, slot_id, kind, label, head_revision)
           VALUES (?, ?, ?, ?, ?, 0)`,
        )
        .run(
          input.userId,
          input.gameId,
          input.slotId,
          input.slotId === 'auto' ? 'auto' : 'manual',
          input.label ?? null,
        );
      const slot = sqlite
        .prepare<[string, string, SaveSlotId], { head_revision: number }>(
          'SELECT head_revision FROM save_slots WHERE user_id = ? AND game_id = ? AND slot_id = ?',
        )
        .get(input.userId, input.gameId, input.slotId);
      const headRevision = slot?.head_revision ?? 0;
      if (input.ifMatch !== headRevision) throw new StaleRevision(headRevision);

      const revision = headRevision + 1;
      sqlite
        .prepare(
          `INSERT INTO save_revisions
             (user_id, game_id, slot_id, revision, branch_id, build_id, release_id,
              save_schema_version, payload, sha256, device_id, client_seq, reason,
              migrated_from_revision, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.userId,
          input.gameId,
          input.slotId,
          revision,
          input.branchId,
          input.buildId,
          input.releaseId ?? null,
          input.saveSchemaVersion,
          Buffer.from(input.payload),
          createHash('sha256').update(input.payload).digest('hex'),
          input.deviceId,
          input.clientSeq,
          input.reason,
          input.migratedFromRevision ?? null,
          now.toISOString(),
        );
      sqlite
        .prepare(
          `UPDATE save_slots SET head_revision = ?, label = COALESCE(?, label)
           WHERE user_id = ? AND game_id = ? AND slot_id = ? AND head_revision = ?`,
        )
        .run(revision, input.label ?? null, input.userId, input.gameId, input.slotId, headRevision);

      sqlite
        .prepare(
          `DELETE FROM save_revisions
           WHERE user_id = ? AND game_id = ? AND slot_id = ? AND revision <= ?
             AND revision NOT IN (
               SELECT migrated_from_revision FROM save_revisions
               WHERE user_id = ? AND game_id = ? AND slot_id = ? AND migrated_from_revision IS NOT NULL
             )`,
        )
        .run(input.userId, input.gameId, input.slotId, revision - 5, input.userId, input.gameId, input.slotId);
      return { revision, replayed: false };
    })
    .immediate();
}

export function getSaveRevision(
  sqlite: Sqlite,
  userId: string,
  gameId: string,
  slotId: SaveSlotId,
  revision?: number,
): SaveRevision {
  const row =
    revision === undefined
      ? sqlite
          .prepare<[string, string, SaveSlotId], RevisionRow>(
            `SELECT r.* FROM save_revisions r
           JOIN save_slots s ON s.user_id = r.user_id AND s.game_id = r.game_id
             AND s.slot_id = r.slot_id AND s.head_revision = r.revision
           WHERE r.user_id = ? AND r.game_id = ? AND r.slot_id = ?`,
          )
          .get(userId, gameId, slotId)
      : sqlite
          .prepare<[string, string, SaveSlotId, number], RevisionRow>(
            `SELECT * FROM save_revisions
           WHERE user_id = ? AND game_id = ? AND slot_id = ? AND revision = ?`,
          )
          .get(userId, gameId, slotId, revision);
  if (!row) throw new SaveNotFound();
  return revisionFromRow(row);
}

export function listSaveSlots(sqlite: Sqlite, userId: string, gameId: string): StoredSaveSlot[] {
  return sqlite
    .prepare<
      [string, string],
      {
        user_id: string;
        game_id: string;
        slot_id: SaveSlotId;
        kind: SaveSlot['kind'];
        label: string | null;
        head_revision: number;
        head_schema: number;
        saved_at: string;
      }
    >(
      `SELECT s.user_id, s.game_id, s.slot_id, s.kind, s.label, s.head_revision,
              r.save_schema_version AS head_schema, r.created_at AS saved_at
       FROM save_slots s
       JOIN save_revisions r ON r.user_id = s.user_id AND r.game_id = s.game_id
         AND r.slot_id = s.slot_id AND r.revision = s.head_revision
       WHERE s.user_id = ? AND s.game_id = ?
       ORDER BY CASE s.slot_id WHEN 'auto' THEN 0 ELSE CAST(s.slot_id AS INTEGER) END`,
    )
    .all(userId, gameId)
    .map((row) => ({
      userId: row.user_id,
      gameId: row.game_id,
      slotId: row.slot_id,
      kind: row.kind,
      label: row.label ?? undefined,
      headRevision: row.head_revision,
      headSchema: row.head_schema,
      savedAt: row.saved_at,
    }));
}

export function listCompatibleRevisions(
  sqlite: Sqlite,
  userId: string,
  gameId: string,
  slotId: SaveSlotId,
  schema: number,
): number[] {
  return sqlite
    .prepare<[string, string, SaveSlotId, number], { revision: number }>(
      `SELECT revision FROM save_revisions
       WHERE user_id = ? AND game_id = ? AND slot_id = ? AND save_schema_version <= ?
       ORDER BY revision DESC`,
    )
    .all(userId, gameId, slotId, schema)
    .map(({ revision }) => revision);
}

export function countSavesAboveSchema(sqlite: Sqlite, gameId: string, schema: number): number {
  return (
    sqlite
      .prepare<[string, number], { count: number }>(
        `SELECT COUNT(*) AS count FROM save_slots s
         JOIN save_revisions r ON r.user_id = s.user_id AND r.game_id = s.game_id
           AND r.slot_id = s.slot_id AND r.revision = s.head_revision
         WHERE s.game_id = ? AND r.save_schema_version > ?`,
      )
      .get(gameId, schema)?.count ?? 0
  );
}
