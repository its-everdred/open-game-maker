import { Hono } from 'hono';
import { z } from 'zod';

import { SAVES_ROUTE, StableIdSchema, type Principal } from '@ogm/contracts';
import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody, parseQuery } from '../app/validate.js';
import { resolveBranch } from '../design/store.js';
import { findGameForFamily, hasGameGrant } from '../games/games.js';
import { LeaseHeld, LeaseMismatch, acquirePlayLease, heartbeatPlayLease } from './lease.js';
import { deriveSaveStatus } from './status.js';
import {
  SaveNotFound,
  StaleRevision,
  getSaveRevision,
  listCompatibleRevisions,
  listSaveSlots,
  putSaveRevision,
  type SaveSlotId,
} from './store.js';

export const prefix = '/api/v1';

const MAX_SAVE_BYTES = 512 * 1024;
const slotSchema = z.enum(['auto', '1', '2', '3']);
const reasonSchema = z.enum(['pause', 'checkpoint', 'interval', 'hidden', 'manual', 'migration', 'update']);
/** The web player lists without `schema` (it learns the game's save schema only when the game saves). */
const listQuery = z.object({
  schema: z.coerce.number().int().nonnegative().optional(),
  migratesFrom: z.coerce.number().int().nonnegative().optional(),
});
const revisionQuery = z.object({ revision: z.coerce.number().int().positive().optional() });
const leaseBody = z
  .object({ deviceId: StableIdSchema, tabId: StableIdSchema, takeover: z.boolean().optional().default(false) })
  .strict();
const heartbeatBody = leaseBody.omit({ takeover: true });

function routeParam(c: Parameters<typeof requirePrincipal>[0], name: string): string {
  const value = c.req.param(name);
  if (!value) throw new HttpError(400, 'invalid_request');
  return value;
}

function slotParam(c: Parameters<typeof requirePrincipal>[0]): SaveSlotId {
  const parsed = slotSchema.safeParse(routeParam(c, 'slotId'));
  if (!parsed.success) throw new HttpError(404, 'save_slot_not_found');
  return parsed.data;
}

function playableGame(c: Parameters<typeof requirePrincipal>[0]): {
  principal: Extract<Principal, { kind: 'user' }>;
  gameId: string;
} {
  const principal = requirePrincipal(c, ['user']);
  const game = findGameForFamily(c.get('deps').db, routeParam(c, 'gameId'), principal.familyId);
  requireAuthorization(
    authorize(actorFromPrincipal(principal), 'game.play', {
      familyId: game.familyId,
      ownerId: game.ownerId,
      visibility: game.visibility,
      releaseState: game.releaseState,
      granted: hasGameGrant(c.get('deps').db, game.id, principal.userId),
    }),
  );
  return { principal, gameId: game.id };
}

function requiredHeader(c: Parameters<typeof requirePrincipal>[0], name: string): string {
  const value = c.req.header(name)?.trim();
  if (!value) throw new HttpError(422, 'invalid_save', undefined, { header: name });
  return value;
}

function nonnegativeHeader(c: Parameters<typeof requirePrincipal>[0], name: string): number {
  const value = requiredHeader(c, name);
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) {
    throw new HttpError(422, 'invalid_save', undefined, { header: name });
  }
  return number;
}

function stableHeader(c: Parameters<typeof requirePrincipal>[0], name: string): string {
  const value = requiredHeader(c, name);
  if (!StableIdSchema.safeParse(value).success) throw new HttpError(422, 'invalid_save', undefined, { header: name });
  return value;
}

/** The SDK sends a branch id; the web player knows only `main` by name, as in its design routes. */
function branchHeader(c: Parameters<typeof requirePrincipal>[0], gameId: string): string {
  if (c.req.header('x-save-branch')?.trim() === 'main') return resolveBranch(c.get('deps').sqlite, gameId, 'main').id;
  return stableHeader(c, 'x-save-branch');
}

function optionalStableHeader(c: Parameters<typeof requirePrincipal>[0], name: string): string | undefined {
  const value = c.req.header(name)?.trim();
  if (!value) return undefined;
  if (!StableIdSchema.safeParse(value).success) throw new HttpError(422, 'invalid_save', undefined, { header: name });
  return value;
}

function idempotencyKey(c: Parameters<typeof requirePrincipal>[0]): { deviceId: string; clientSeq: number } {
  const value = requiredHeader(c, 'idempotency-key');
  const separator = value.lastIndexOf(':');
  const deviceId = value.slice(0, separator);
  const sequence = value.slice(separator + 1);
  const clientSeq = Number(sequence);
  if (
    separator < 1 ||
    !StableIdSchema.safeParse(deviceId).success ||
    !/^\d+$/.test(sequence) ||
    !Number.isSafeInteger(clientSeq)
  ) {
    throw new HttpError(422, 'invalid_save', undefined, { header: 'idempotency-key' });
  }
  return { deviceId, clientSeq };
}

const saves = new Hono<ApiBindings>();

saves.get('/', (c) => {
  const { principal, gameId } = playableGame(c);
  const query = parseQuery(c, listQuery);
  const slots = listSaveSlots(c.get('deps').sqlite, principal.userId, gameId).map(({ headSchema, ...slot }) => {
    const schema = query.schema ?? headSchema;
    return {
      ...slot,
      status: deriveSaveStatus(headSchema, schema, query.migratesFrom),
      olderCompatible: listCompatibleRevisions(c.get('deps').sqlite, principal.userId, gameId, slot.slotId, schema),
    };
  });
  return c.json({ slots });
});

saves.get('/:slotId', (c) => {
  const { principal, gameId } = playableGame(c);
  const query = parseQuery(c, revisionQuery);
  try {
    const revision = getSaveRevision(c.get('deps').sqlite, principal.userId, gameId, slotParam(c), query.revision);
    c.header('content-type', 'application/octet-stream');
    c.header('content-encoding', 'gzip');
    c.header('x-save-schema', String(revision.saveSchemaVersion));
    c.header('x-save-revision', String(revision.revision));
    c.header('x-save-branch', revision.branchId);
    c.header('x-save-build', revision.buildId);
    if (revision.releaseId) c.header('x-save-release', revision.releaseId);
    if (revision.migratedFromRevision !== undefined) {
      c.header('x-save-migrated-from', String(revision.migratedFromRevision));
    }
    const bytes = revision.payload.buffer.slice(
      revision.payload.byteOffset,
      revision.payload.byteOffset + revision.payload.byteLength,
    ) as ArrayBuffer;
    return c.body(bytes);
  } catch (error) {
    if (error instanceof SaveNotFound) throw new HttpError(404, 'save_not_found');
    throw error;
  }
});

saves.put('/:slotId', async (c) => {
  const { principal, gameId } = playableGame(c);
  const slotId = slotParam(c);
  const length = c.req.header('content-length');
  if (length && Number(length) > MAX_SAVE_BYTES) return c.json({ error: 'payload_too_large' }, 413);
  if (c.req.header('content-type')?.split(';', 1)[0] !== 'application/octet-stream') {
    throw new HttpError(422, 'invalid_save', undefined, { header: 'content-type' });
  }
  if (c.req.header('content-encoding')?.toLowerCase() !== 'gzip') {
    throw new HttpError(422, 'invalid_save', undefined, { header: 'content-encoding' });
  }

  const key = idempotencyKey(c);
  const payload = new Uint8Array(await c.req.arrayBuffer());
  if (payload.byteLength > MAX_SAVE_BYTES) return c.json({ error: 'payload_too_large' }, 413);
  const reason = reasonSchema.safeParse(requiredHeader(c, 'x-save-reason'));
  if (!reason.success) throw new HttpError(422, 'invalid_save', undefined, { header: 'x-save-reason' });
  const migratedFrom = c.req.header('x-save-migrated-from');
  const migratedFromRevision = migratedFrom === undefined ? undefined : Number(migratedFrom);
  if (migratedFrom !== undefined && (!/^\d+$/.test(migratedFrom) || !Number.isSafeInteger(migratedFromRevision))) {
    throw new HttpError(422, 'invalid_save', undefined, { header: 'x-save-migrated-from' });
  }

  try {
    const result = putSaveRevision(c.get('deps').sqlite, {
      userId: principal.userId,
      gameId,
      slotId,
      ifMatch: nonnegativeHeader(c, 'if-match'),
      payload,
      branchId: branchHeader(c, gameId),
      buildId: stableHeader(c, 'x-save-build'),
      releaseId: optionalStableHeader(c, 'x-save-release'),
      saveSchemaVersion: nonnegativeHeader(c, 'x-save-schema'),
      deviceId: key.deviceId,
      clientSeq: key.clientSeq,
      reason: reason.data,
      label: c.req.header('x-save-label')?.slice(0, 80),
      migratedFromRevision,
    });
    return c.json({ revision: result.revision });
  } catch (error) {
    if (error instanceof LeaseMismatch) return c.json({ heldBy: error.heldBy }, 423);
    if (error instanceof StaleRevision) return c.json({ headRevision: error.headRevision }, 409);
    throw error;
  }
});

saves.post('/lease', async (c) => {
  const { principal, gameId } = playableGame(c);
  const body = await parseBody(c, leaseBody);
  try {
    return c.json(
      acquirePlayLease(
        c.get('deps').sqlite,
        { userId: principal.userId, gameId, ...body },
        { takeover: body.takeover },
      ),
    );
  } catch (error) {
    if (error instanceof LeaseHeld) return c.json({ heldBy: error.heldBy }, 409);
    throw error;
  }
});

saves.post('/lease/heartbeat', async (c) => {
  const { principal, gameId } = playableGame(c);
  const body = await parseBody(c, heartbeatBody);
  try {
    return c.json(heartbeatPlayLease(c.get('deps').sqlite, { userId: principal.userId, gameId, ...body }));
  } catch (error) {
    if (error instanceof LeaseMismatch) return c.json({ heldBy: error.heldBy }, 423);
    throw error;
  }
});

const routes = new Hono<ApiBindings>();
routes.route(SAVES_ROUTE, saves);
/** Pre-#281 path that released game builds still call; remove after one release. */
routes.route('/saves/:gameId', saves);

export default routes;
