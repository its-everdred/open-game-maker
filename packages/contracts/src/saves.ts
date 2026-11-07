import { z } from 'zod';

import { IsoTimeSchema, RevisionSchema, Sha256Schema, StableIdSchema } from './design-log.js';

export const SaveSlotSchema = z.looseObject({
  userId: StableIdSchema,
  gameId: StableIdSchema,
  slotId: z.enum(['auto', '1', '2', '3']),
  kind: z.enum(['auto', 'manual']),
  label: z.string().optional(),
  headRevision: RevisionSchema,
  status: z.enum(['ok', 'needs_migration', 'unsupported_old', 'incompatible_after_rollback']),
});
export type SaveSlot = z.infer<typeof SaveSlotSchema>;

const saveRevisionShape = {
  userId: StableIdSchema,
  gameId: StableIdSchema,
  slotId: z.string(),
  revision: RevisionSchema,
  branchId: StableIdSchema,
  buildId: StableIdSchema,
  releaseId: StableIdSchema.optional(),
  saveSchemaVersion: z.number().int().nonnegative(),
  sha256: Sha256Schema,
  deviceId: StableIdSchema,
  clientSeq: z.number().int().nonnegative(),
  reason: z.enum(['pause', 'checkpoint', 'interval', 'hidden', 'manual', 'migration', 'update']),
  migratedFromRevision: RevisionSchema.optional(),
  createdAt: IsoTimeSchema,
};

export const SaveRevisionSchema = z.looseObject({ ...saveRevisionShape, payload: z.instanceof(Uint8Array) });
export type SaveRevision = z.infer<typeof SaveRevisionSchema>;

/** JSON fixtures and emitted schemas carry byte payloads as base64 strings. */
export const SaveRevisionJsonSchema = z.looseObject({
  ...saveRevisionShape,
  payload: z.string().meta({ contentEncoding: 'base64' }),
});

export const PlayLeaseSchema = z.looseObject({
  userId: StableIdSchema,
  gameId: StableIdSchema,
  deviceId: StableIdSchema,
  tabId: StableIdSchema,
  expiresAt: IsoTimeSchema,
});
export type PlayLease = z.infer<typeof PlayLeaseSchema>;

export const AchievementDefSchema = z.looseObject({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string(),
  hidden: z.boolean(),
  progress: z.looseObject({ target: z.number() }).optional(),
  retired: z.boolean().optional(),
});
export type AchievementDef = z.infer<typeof AchievementDefSchema>;

export const AnalyticsEventSchema = z.looseObject({
  ts: IsoTimeSchema,
  gameId: StableIdSchema,
  branchId: StableIdSchema,
  releaseId: StableIdSchema.optional(),
  env: z.enum(['draft', 'published']),
  pseudoUserId: z.string(),
  sessionId: z.string(),
  name: z.string(),
  scope: z.string().optional(),
  marker: z.string().optional(),
  outcome: z.enum(['complete', 'fail', 'quit']).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

export const SavesFamilySchema = z.looseObject({
  saveSlot: SaveSlotSchema,
  saveRevision: SaveRevisionJsonSchema,
  playLease: PlayLeaseSchema,
  achievementDef: AchievementDefSchema,
  analyticsEvent: AnalyticsEventSchema,
});

export const savesSchemas = {
  'saves.v1': SavesFamilySchema,
} satisfies Record<string, z.ZodType>;

/** Saves live under their game: `/games/:gameId/saves[/:slotId]`, relative to the `/api/v1` prefix. */
export const SAVES_ROUTE = '/games/:gameId/saves';

/**
 * The running build's save facts. The API judges each stored slot against the build that is playing, so a slot the
 * build cannot read is reported as such instead of comparing the slot with its own head schema.
 */
export type SaveListQuery = { schema: number; migratesFrom?: number };

export function savesPath(gameId: string, slotId?: SaveSlot['slotId']): string {
  const base = `/games/${encodeURIComponent(gameId)}/saves`;
  return slotId === undefined ? base : `${base}/${encodeURIComponent(slotId)}`;
}

/** `savesPath` plus the build's schema, as the list route reads it. */
export function savesListPath(gameId: string, query: SaveListQuery): string {
  const params = new URLSearchParams({ schema: String(query.schema) });
  if (query.migratesFrom !== undefined) params.set('migratesFrom', String(query.migratesFrom));
  return `${savesPath(gameId)}?${params.toString()}`;
}
