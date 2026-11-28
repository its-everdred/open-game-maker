import { Hono } from 'hono';
import { z } from 'zod';

import type { Principal } from '@ogm/contracts';
import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { createRateLimiter } from '../auth/rate-limit.js';
import { findGameForFamily, findGameForPlay, getGameAccess, hasGameGrant, type GameRow } from '../games/games.js';
import { AchievementError, award, listAchievements, progress, revokeAward } from './store.js';

export const prefix = '/api/v1';

const awardBody = z.object({ key: z.string().min(1).max(64), releaseId: z.string().min(1).max(200) }).strict();
const progressBody = awardBody.extend({ value: z.number().finite().nonnegative() }).strict();
const allowAward = createRateLimiter(30, 60_000);

type UserPrincipal = Extract<Principal, { kind: 'user' }>;

function routeParam(c: Parameters<typeof requirePrincipal>[0], name: string): string {
  const value = c.req.param(name);
  if (!value) throw new HttpError(400, 'invalid_request');
  return value;
}

function playableGame(c: Parameters<typeof requirePrincipal>[0]): { principal: UserPrincipal; game: GameRow } {
  const principal = requirePrincipal(c, ['user']);
  const game = findGameForPlay(c.get('deps').db, routeParam(c, 'gameId'), actorFromPrincipal(principal));
  requireAuthorization(
    authorize(actorFromPrincipal(principal), 'game.play', {
      familyId: game.familyId,
      ownerId: game.ownerId,
      visibility: game.visibility,
      releaseState: game.releaseState,
      granted: hasGameGrant(c.get('deps').db, game.id, principal.userId),
      gameAccess: getGameAccess(c.get('deps').db, game.id, principal.userId),
    }),
  );
  return { principal, game };
}

function achievementResult<T>(callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    if (error instanceof AchievementError) throw new HttpError(422, error.code);
    throw error;
  }
}

const routes = new Hono<ApiBindings>()
  .get('/games/:gameId/achievements', (c) => {
    const { principal, game } = playableGame(c);
    return c.json({ achievements: listAchievements(c.get('deps').db, game.id, principal.userId) });
  })
  .post('/games/:gameId/achievements/award', async (c) => {
    const { principal, game } = playableGame(c);
    if (!allowAward(`${principal.userId}:${game.id}`)) throw new HttpError(429, 'rate_limited');
    const body = await parseBody(c, awardBody);
    return c.json(
      achievementResult(() =>
        award(c.get('deps').db, {
          userId: principal.userId,
          gameId: game.id,
          key: body.key,
          releaseId: body.releaseId,
          source: 'client',
        }),
      ),
    );
  })
  .post('/games/:gameId/achievements/progress', async (c) => {
    const { principal, game } = playableGame(c);
    if (!allowAward(`${principal.userId}:${game.id}`)) throw new HttpError(429, 'rate_limited');
    const body = await parseBody(c, progressBody);
    return c.json(
      achievementResult(() =>
        progress(c.get('deps').db, {
          userId: principal.userId,
          gameId: game.id,
          key: body.key,
          value: body.value,
          releaseId: body.releaseId,
        }),
      ),
    );
  })
  .delete('/games/:gameId/achievements/awards/:userId/:key', (c) => {
    const principal = requirePrincipal(c, ['user']);
    const game = findGameForFamily(c.get('deps').db, c.req.param('gameId'), principal.familyId);
    requireAuthorization(authorize(actorFromPrincipal(principal), 'admin.analytics.read', { familyId: game.familyId }));
    return c.json({
      revoked: revokeAward(c.get('deps').db, {
        userId: c.req.param('userId'),
        gameId: game.id,
        key: c.req.param('key'),
        byUserId: principal.userId,
      }),
    });
  });

export default routes;
