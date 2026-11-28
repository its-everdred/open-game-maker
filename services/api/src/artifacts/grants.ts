import { createHmac, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { principalMiddleware } from '../app/principal.js';
import { authorize } from '@ogm/policy';
import { actorFromPrincipal } from '../accounts/families.js';
import { getGameAccess, hasGameGrant } from '../games/games.js';
import { currentPublishedBuild } from './published.js';
import { sameSecret } from '../app/internal-auth.js';
import { HttpError } from '../app/errors.js';
import { authContextFor } from '../auth/routes.js';
import { artifactEpoch, issueSessionGrant, readSessionGrant } from './session-grants.js';
import type { Principal } from '@ogm/contracts';

interface Grant {
  gameId: string;
  buildId: string;
  userId: string;
  headers: Headers;
  expires: number;
  kind?: 'player' | 'operator';
  previewSource?: string;
  userEpoch?: string;
  gameEpoch?: string;
}
const grants = new WeakMap<AppDeps, Map<string, Grant>>();
const previews = new WeakMap<AppDeps, Map<string, Grant>>();
const MAX_GRANTS = 4096;
const MAX_USER_GRANTS = 128;
const DRAFT_TTL_MS = 30 * 60_000;
const PREVIEW_TTL_MS = 30 * 60_000;
const timers = new WeakMap<Map<string, Grant>, Map<string, NodeJS.Timeout>>();

export function hasCreatorMembership(deps: AppDeps, familyId: string, userId: string): boolean {
  return (
    deps.db
      .select({ capability: schema.familyMembers.capability })
      .from(schema.familyMembers)
      .where(and(eq(schema.familyMembers.familyId, familyId), eq(schema.familyMembers.userId, userId)))
      .get()?.capability === 'creator'
  );
}

export function canAccessDraft(
  deps: AppDeps,
  game: typeof schema.games.$inferSelect,
  principal: Extract<Principal, { kind: 'user' }>,
): boolean {
  if (principal.capability !== 'creator') return false;
  if (principal.userId === game.ownerId)
    return principal.familyId === game.familyId && hasCreatorMembership(deps, game.familyId, principal.userId);
  return (
    game.delistedAt === null &&
    authorize(actorFromPrincipal(principal), 'game.edit', {
      familyId: game.familyId,
      ownerId: game.ownerId,
      gameAccess: getGameAccess(deps.db, game.id, principal.userId),
    }).ok
  );
}

function remove(entries: Map<string, Grant>, key: string): void {
  entries.delete(key);
  const scheduled = timers.get(entries);
  const timer = scheduled?.get(key);
  if (timer) clearTimeout(timer);
  scheduled?.delete(key);
}

function expire(entries: Map<string, Grant>, key: string): void {
  let scheduled = timers.get(entries);
  if (!scheduled) {
    scheduled = new Map();
    timers.set(entries, scheduled);
  }
  const previous = scheduled.get(key);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(
    () => {
      const grant = entries.get(key);
      if (grant && grant.expires <= Date.now()) remove(entries, key);
    },
    Math.max(1, (entries.get(key)?.expires ?? Date.now()) - Date.now() + 1),
  );
  timer.unref();
  scheduled.set(key, timer);
}

function requireCapacity(entries: Map<string, Grant>, userId: string): void {
  const own = [...entries].filter(([, grant]) => grant.userId === userId);
  if (own.length >= MAX_USER_GRANTS) remove(entries, own[0]![0]);
  if (entries.size >= MAX_GRANTS) throw new HttpError(429, 'artifact_grant_limit');
}

export function bindPreview(deps: AppDeps, gameId: string, accessId: string, userId: string, headers: Headers): string {
  let entries = previews.get(deps);
  if (!entries) {
    entries = new Map();
    previews.set(deps, entries);
  }
  for (const [key, grant] of entries) if (grant.expires <= Date.now()) remove(entries, key);
  const savedHeaders = credentials(headers);
  for (const [key, grant] of entries) {
    if (
      grant.gameId === gameId &&
      grant.previewSource === accessId &&
      grant.userId === userId &&
      grant.userEpoch === artifactEpoch(deps.db, 'user', userId) &&
      grant.gameEpoch === artifactEpoch(deps.db, 'game', gameId) &&
      grant.headers.get('cookie') === savedHeaders.get('cookie') &&
      grant.headers.get('authorization') === savedHeaders.get('authorization')
    ) {
      grant.expires = Date.now() + PREVIEW_TTL_MS;
      entries.delete(key);
      entries.set(key, grant);
      expire(entries, key);
      return key;
    }
  }
  const alias = `pv-${randomUUID()}`;
  requireCapacity(entries, userId);
  entries.set(alias, {
    gameId,
    buildId: '',
    userId,
    headers: savedHeaders,
    expires: Date.now() + PREVIEW_TTL_MS,
    previewSource: accessId,
    userEpoch: artifactEpoch(deps.db, 'user', userId),
    gameEpoch: artifactEpoch(deps.db, 'game', gameId),
  });
  expire(entries, alias);
  return alias;
}

function credentials(headers: Headers): Headers {
  const result = new Headers();
  for (const name of ['cookie', 'authorization', 'x-ogm-internal']) {
    const value = headers.get(name);
    if (value && value.length <= 8192) result.set(name, value);
  }
  return result;
}

export async function issueGrant(
  deps: AppDeps,
  gameId: string,
  buildId: string,
  userId: string,
  headers: Headers,
  kind?: 'player' | 'operator',
): Promise<string> {
  const auth = authContextFor(deps)?.auth;
  if (kind !== 'operator' && auth) {
    const session = await auth.api.getSession({ headers });
    if (!session || session.user.id !== userId) throw new HttpError(404, 'artifact_grant_session');
    return issueSessionGrant(deps, session.session.id, userId, gameId, buildId, kind ?? 'owner');
  }
  const ttl = kind === 'operator' ? PREVIEW_TTL_MS : DRAFT_TTL_MS;
  let entries = grants.get(deps);
  if (!entries) {
    entries = new Map();
    grants.set(deps, entries);
  }
  for (const [key, grant] of entries) if (grant.expires <= Date.now()) remove(entries, key);
  const savedHeaders = credentials(headers);
  for (const [key, grant] of entries) {
    if (
      grant.gameId === gameId &&
      grant.buildId === buildId &&
      grant.userId === userId &&
      grant.kind === kind &&
      grant.headers.get('cookie') === savedHeaders.get('cookie') &&
      grant.headers.get('authorization') === savedHeaders.get('authorization') &&
      grant.headers.get('x-ogm-internal') === savedHeaders.get('x-ogm-internal')
    ) {
      grant.expires = Date.now() + ttl;
      entries.delete(key);
      entries.set(key, grant);
      expire(entries, key);
      return key;
    }
  }
  // A renewed authenticated session recovers its exact URL even after the
  // in-memory grant expired or the API restarted. The HMAC never reveals the session.
  const token = createHmac('sha256', deps.config.jobTokenSecret)
    .update('artifact-grant-v1:')
    .update(
      JSON.stringify([
        gameId,
        buildId,
        userId,
        kind ?? 'owner',
        savedHeaders.get('cookie'),
        savedHeaders.get('authorization'),
        savedHeaders.get('x-ogm-internal'),
      ]),
    )
    .digest('base64url');
  requireCapacity(entries, userId);
  entries.set(token, {
    gameId,
    buildId,
    userId,
    headers: savedHeaders,
    expires: Date.now() + ttl,
    ...(kind ? { kind } : {}),
  });
  expire(entries, token);
  return token;
}

export async function validGrant(deps: AppDeps, token: string, gameId: string, buildId: string): Promise<boolean> {
  const sessionGrant = readSessionGrant(deps, token, gameId, buildId);
  const grant = sessionGrant ? { ...sessionGrant, gameId, buildId, expires: Infinity } : grants.get(deps)?.get(token);
  if (!grant || grant.gameId !== gameId || grant.buildId !== buildId || grant.expires <= Date.now()) return false;
  const build = deps.db
    .select()
    .from(schema.builds)
    .where(
      and(
        eq(schema.builds.id, buildId),
        eq(schema.builds.gameId, gameId),
        eq(schema.builds.status, 'tested'),
        eq(schema.builds.artifact, 'present'),
      ),
    )
    .get();
  if (!build) return false;
  if (grant.kind === 'operator') {
    const token = grant.headers.get('x-ogm-internal');
    return !!token && sameSecret(token, deps.config.internalToken);
  }
  return validOwner(deps, grant);
}

export async function validPreview(deps: AppDeps, gameId: string, accessId: string): Promise<string | null> {
  const entries = previews.get(deps);
  const grant = entries?.get(accessId);
  const allowed =
    grant &&
    grant.gameId === gameId &&
    grant.expires > Date.now() &&
    grant.previewSource &&
    grant.userEpoch === artifactEpoch(deps.db, 'user', grant.userId) &&
    grant.gameEpoch === artifactEpoch(deps.db, 'game', gameId) &&
    (await validOwner(deps, grant));
  if (!allowed && grant && entries) remove(entries, accessId);
  return allowed && grant ? (grant.previewSource ?? null) : null;
}

async function validOwner(deps: AppDeps, grant: Grant): Promise<boolean> {
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, grant.gameId)).get();
  if (!game) return false;
  if (grant.kind === 'player' && currentPublishedBuild(deps, game.id) !== grant.buildId) return false;
  // Re-resolve the original session on every request so sign-out, allow-list changes,
  // ownership changes and role demotion immediately invalidate an existing URL.
  const app = new Hono<ApiBindings>();
  app.use(async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use(principalMiddleware());
  app.get('/', (c) => {
    const principal = c.get('principal');
    if (principal.kind !== 'user' || principal.userId !== grant.userId) return c.json({ allowed: false });
    const allowed =
      grant.kind === 'player'
        ? authorize(actorFromPrincipal(principal), 'game.play', {
            familyId: game.familyId,
            ownerId: game.ownerId,
            visibility: game.visibility,
            releaseState: game.releaseState,
            granted: hasGameGrant(deps.db, game.id, principal.userId),
            gameAccess: getGameAccess(deps.db, game.id, principal.userId),
          }).ok
        : canAccessDraft(deps, game, principal);
    return c.json({ allowed });
  });
  const response = await app.request('http://127.0.0.1/', { headers: grant.headers });
  if (!response.ok) return false;
  return ((await response.json()) as { allowed: boolean }).allowed === true;
}
