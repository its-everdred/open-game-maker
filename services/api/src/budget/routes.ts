import { Hono } from 'hono';
import { z } from 'zod';

import { EstimateRequest, Id } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { eq } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody, parseQuery } from '../app/validate.js';
import { estimate } from './estimate.js';
import { getBudgetSettings } from './settings.js';
import { budgetStatus } from './status.js';
import { toUnits } from './units.js';

const statusQuery = z.object({ userId: Id.optional(), unit: z.enum(['units', 'usd']).default('units') }).strict();

function defaults(deps: AppDeps) {
  return {
    dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
    defaultAllowanceConfigured: deps.config.defaultDailyAllowanceConfigured,
    resetZone: deps.config.resetZoneDefault,
  };
}

const routes = new Hono<ApiBindings>()
  .get('/status', (c) => {
    const actor = actorFromPrincipal(requirePrincipal(c, ['user']));
    const { userId = actor.userId, unit } = parseQuery(c, statusQuery);
    const deps = c.get('deps');
    const isAdmin = authorize(actor, 'admin.budget.set', { familyId: actor.familyId }).ok;
    if (unit === 'usd' && !isAdmin) throw new HttpError(403, 'unit_not_allowed');
    if (userId !== actor.userId) {
      const member = deps.db
        .select({ familyId: schema.familyMembers.familyId })
        .from(schema.familyMembers)
        .where(eq(schema.familyMembers.userId, userId))
        .get();
      if (!member) throw new HttpError(404, 'user_not_found');
      requireAuthorization(authorize(actor, 'admin.budget.set', { familyId: member.familyId }));
    }
    const status = budgetStatus(
      { db: deps.db, defaults: defaults(deps) },
      { familyId: actor.familyId, userId, now: new Date() },
    );
    if (unit === 'usd') return c.json({ ...status, usd: status.remainingMicroUsd / 1_000_000 });
    const settings = getBudgetSettings(deps.db, actor.familyId, defaults(deps));
    return c.json({ ...status, ...toUnits(status.remainingMicroUsd, settings) });
  })
  .post('/estimate', async (c) => {
    const actor = actorFromPrincipal(requirePrincipal(c, ['user']));
    const body = await parseBody(c, EstimateRequest);
    const deps = c.get('deps');
    const game = deps.db.select().from(schema.games).where(eq(schema.games.id, body.gameId)).get();
    if (!game) throw new HttpError(404, 'game_not_found');
    requireAuthorization(
      authorize(actor, 'job.create', { gameId: game.id, familyId: game.familyId, ownerId: game.ownerId }),
    );
    return c.json(
      estimate(
        { db: deps.db, defaults: defaults(deps) },
        { familyId: game.familyId, creatorId: actor.userId, gameId: game.id, summary: body.summary },
      ),
    );
  });

export default routes;
