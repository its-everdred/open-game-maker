import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { paidApisDuringGameplay, setPaidApisDuringGameplay } from './policy.js';

// The instance-wide gameplay setting. Only an instance admin reads or changes it; it is not scoped to a family.
export const prefix = '/api/v1/admin/gameplay';

const PatchBody = z.object({ paidApisDuringGameplay: z.boolean() }).strict();

function instanceAdmin(c: Context<ApiBindings>) {
  const actor = actorFromPrincipal(requirePrincipal(c, ['user']));
  requireAuthorization(authorize(actor, 'admin.gameplay.set'));
  return actor;
}

export default new Hono<ApiBindings>()
  .get('/', (c) => {
    instanceAdmin(c);
    return c.json({ paidApisDuringGameplay: paidApisDuringGameplay(c.get('deps').db) });
  })
  .patch('/', async (c) => {
    const actor = instanceAdmin(c);
    const { paidApisDuringGameplay: allowed } = await parseBody(c, PatchBody);
    const deps = c.get('deps');
    setPaidApisDuringGameplay(deps.db, allowed);
    deps.log({ event: 'gameplay_paid_apis_set', userId: actor.userId, allowed });
    return c.json({ paidApisDuringGameplay: paidApisDuringGameplay(deps.db) });
  });
