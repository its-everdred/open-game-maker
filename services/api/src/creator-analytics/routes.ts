import { Hono } from 'hono';
import { z } from 'zod';

import type { Principal } from '@ogm/contracts';
import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody, parseQuery } from '../app/validate.js';
import { createRateLimiter } from '../auth/rate-limit.js';
import { findGameForFamily, hasGameGrant, type GameRow } from '../games/games.js';
import { ingestPlayEvents } from './ingest.js';
import { queryAttempts, queryFunnel, queryOverview, queryReleases, type AnalyticsRange } from './query.js';

export const prefix = '/api/v1';

const playEventsBody = z.object({ events: z.array(z.unknown()).min(1) }).strict();
const rangeQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const limiters = new WeakMap<AppDeps, ReturnType<typeof createRateLimiter>>();

type UserPrincipal = Extract<Principal, { kind: 'user' }>;

function routeParam(c: Parameters<typeof requirePrincipal>[0], name: string): string {
  const value = c.req.param(name);
  if (!value) throw new HttpError(400, 'invalid_request');
  return value;
}

function playableGame(c: Parameters<typeof requirePrincipal>[0]): { principal: UserPrincipal; game: GameRow } {
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
  return { principal, game };
}

function ownedGame(c: Parameters<typeof requirePrincipal>[0]): GameRow {
  const principal = requirePrincipal(c, ['user']);
  const game = findGameForFamily(c.get('deps').db, routeParam(c, 'gameId'), principal.familyId);
  const actor = actorFromPrincipal(principal);
  const ownerAccess = authorize(actor, 'game.edit', { familyId: game.familyId, ownerId: game.ownerId });
  if (!ownerAccess.ok) requireAuthorization(authorize(actor, 'admin.analytics.read', { familyId: game.familyId }));
  return game;
}

function analyticsRange(c: Parameters<typeof parseQuery>[0]): AnalyticsRange {
  const query = parseQuery(c, rangeQuery);
  const to = query.to ?? new Date().toISOString().slice(0, 10);
  const from =
    query.from ?? new Date(Date.parse(`${to}T00:00:00.000Z`) - 29 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  if (from > to) throw new HttpError(400, 'invalid_range');
  return { from, to };
}

function sessionIdForRateLimit(event: unknown): string {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return 'invalid';
  const sessionId = (event as { sessionId?: unknown }).sessionId;
  return typeof sessionId === 'string' ? sessionId : 'invalid';
}

const routes = new Hono<ApiBindings>()
  .post('/games/:gameId/play-events', async (c) => {
    const { principal, game } = playableGame(c);
    const body = await parseBody(c, playEventsBody);
    if (body.events.length > 200) throw new HttpError(413, 'too_many_events');
    const limiter = limiters.get(c.get('deps')) ?? createRateLimiter(5, 60_000);
    limiters.set(c.get('deps'), limiter);
    const sessions = new Set(body.events.map(sessionIdForRateLimit));
    for (const sessionId of sessions) {
      if (!limiter(`${principal.userId}:${game.id}:${sessionId}`)) throw new HttpError(429, 'rate_limited');
    }
    return c.json(ingestPlayEvents(c.get('deps').db, principal.userId, game.id, body.events), 202);
  })
  .get('/games/:gameId/analytics/overview', (c) => {
    const game = ownedGame(c);
    return c.json(queryOverview(c.get('deps').db, game.id, analyticsRange(c)));
  })
  .get('/games/:gameId/analytics/funnel', (c) => {
    const game = ownedGame(c);
    return c.json(queryFunnel(c.get('deps').db, game.id, analyticsRange(c)));
  })
  .get('/games/:gameId/analytics/attempts', (c) => {
    const game = ownedGame(c);
    return c.json({ attempts: queryAttempts(c.get('deps').db, game.id, analyticsRange(c)) });
  })
  .get('/games/:gameId/analytics/releases', (c) => {
    const game = ownedGame(c);
    return c.json({ releases: queryReleases(c.get('deps').db, game.id, analyticsRange(c)) });
  });

export default routes;
