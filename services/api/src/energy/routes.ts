import type { Context } from 'hono';
import { Hono } from 'hono';

import { EnergyCapsUpdate, EnergyLimits, EnergyPreferenceUpdate } from '@ogm/contracts';
import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { readHistory } from './samples.js';
import { readEnergySnapshot } from './source.js';
import { readPreference, writeCaps, writeLimits, writePreference } from './store.js';
import { adminView, playerView } from './view.js';
import { weeklyJobs } from '../budget/weekly-jobs.js';

function snapshot(c: Context<ApiBindings>) {
  const { db, config, registry } = c.get('deps');
  return readEnergySnapshot(
    { db, zone: config.resetZoneDefault, readings: registry.energyReadings, netlifyLog: registry.energyNetlifyLog },
    new Date(),
  );
}

async function admin(c: Context<ApiBindings>, userId: string) {
  const { db } = c.get('deps');
  const now = new Date();
  return adminView(await snapshot(c), readPreference(db, userId), readHistory(db, now));
}

async function creatorView(c: Context<ApiBindings>, userId: string, preference: Parameters<typeof playerView>[1]) {
  const deps = c.get('deps');
  const weekly = weeklyJobs(deps.db, userId, new Date(), deps.config.resetZoneDefault);
  const view = playerView(await snapshot(c), preference);
  const remaining = weekly.remaining;
  const shares = (['newGames', 'edits'] as const).flatMap((kind) => {
    const limit = weekly.limits[kind];
    const left = remaining[kind];
    return limit === null || left === null ? [] : [limit === 0 ? 0 : left / limit];
  });
  const lowest = shares.length ? Math.min(...shares) : null;
  const level =
    lowest === null
      ? view.level
      : lowest <= 0
        ? 'critical'
        : lowest < 0.25
          ? view.level === 'critical'
            ? 'critical'
            : 'limited'
          : view.level === 'unknown'
            ? 'healthy'
            : view.level;
  return {
    ...view,
    level,
    weeklyJobs: {
      newGames: { limit: weekly.limits.newGames, remaining: remaining.newGames },
      edits: { limit: weekly.limits.edits, remaining: weekly.remaining.edits },
      resetsAt: weekly.resetsAt,
    },
  };
}

// Energy limits are instance-wide, so only a platform admin (no family scope) may read costs or set them.
function platformAdmin(c: Context<ApiBindings>) {
  const actor = actorFromPrincipal(requirePrincipal(c, ['user']));
  requireAuthorization(authorize(actor, 'admin.budget.set'));
  return actor;
}

const routes = new Hono<ApiBindings>()
  .get('/', async (c) => {
    const actor = actorFromPrincipal(requirePrincipal(c, ['user']));
    return c.json(await creatorView(c, actor.userId, readPreference(c.get('deps').db, actor.userId)));
  })
  .put('/preference', async (c) => {
    const actor = actorFromPrincipal(requirePrincipal(c, ['user']));
    const { preference } = await parseBody(c, EnergyPreferenceUpdate);
    const { db } = c.get('deps');
    writePreference(db, actor.userId, preference, new Date());
    return c.json(await creatorView(c, actor.userId, preference));
  })
  .get('/admin', async (c) => {
    const actor = platformAdmin(c);
    return c.json(await admin(c, actor.userId));
  })
  .put('/admin/limits', async (c) => {
    const actor = platformAdmin(c);
    const limits = await parseBody(c, EnergyLimits);
    const { db } = c.get('deps');
    writeLimits(db, limits, new Date());
    return c.json(await admin(c, actor.userId));
  })
  // OGM's own caps only: an aiur cap or provider window id fails validation (aiur owns those).
  .put('/admin/caps', async (c) => {
    const actor = platformAdmin(c);
    const caps = await parseBody(c, EnergyCapsUpdate);
    writeCaps(c.get('deps').db, caps, new Date());
    return c.json(await admin(c, actor.userId));
  });

export default routes;
