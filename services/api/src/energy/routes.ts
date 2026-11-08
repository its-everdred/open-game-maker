import type { Context } from 'hono';
import { Hono } from 'hono';

import { EnergyLimits, EnergyPreferenceUpdate } from '@ogm/contracts';
import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { energySource } from './source.js';
import { readPreference, writeLimits, writePreference } from './store.js';
import { adminView, playerView } from './view.js';

function snapshot(c: Context<ApiBindings>) {
  const { db, config } = c.get('deps');
  return energySource({ db, zone: config.resetZoneDefault }).snapshot(new Date());
}

// Energy limits are instance-wide, so only a platform admin (no family scope) may read costs or set them.
function platformAdmin(c: Context<ApiBindings>) {
  const actor = actorFromPrincipal(requirePrincipal(c, ['user']));
  requireAuthorization(authorize(actor, 'admin.budget.set'));
  return actor;
}

const routes = new Hono<ApiBindings>()
  .get('/', (c) => {
    const actor = actorFromPrincipal(requirePrincipal(c, ['user']));
    return c.json(playerView(snapshot(c), readPreference(c.get('deps').db, actor.userId)));
  })
  .put('/preference', async (c) => {
    const actor = actorFromPrincipal(requirePrincipal(c, ['user']));
    const { preference } = await parseBody(c, EnergyPreferenceUpdate);
    const { db } = c.get('deps');
    writePreference(db, actor.userId, preference, new Date());
    return c.json(playerView(snapshot(c), preference));
  })
  .get('/admin', (c) => {
    const actor = platformAdmin(c);
    return c.json(adminView(snapshot(c), readPreference(c.get('deps').db, actor.userId)));
  })
  .put('/admin/limits', async (c) => {
    const actor = platformAdmin(c);
    const limits = await parseBody(c, EnergyLimits);
    const { db } = c.get('deps');
    writeLimits(db, limits, new Date());
    return c.json(adminView(snapshot(c), readPreference(db, actor.userId)));
  });

export default routes;
