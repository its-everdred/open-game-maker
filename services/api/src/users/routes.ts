import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import { schema } from '@ogm/db';
import { authorize, type Actor } from '@ogm/policy';
import { and, eq } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { normalizeEmail } from '../auth/access.js';
import {
  addAllowedUser,
  listAllowedUsers,
  removeAllowedUser,
  roleForEmail,
  setAllowedRole,
} from '../auth/allow-list.js';
import { authContextFor } from '../auth/routes.js';
import { weeklyLimits } from '../budget/weekly-jobs.js';
import { energyProbeOwnsEmail } from '../qa/energy-probe.js';

// The instance sign-in allow list and its roles. Every route is admin-only, so a player cannot
// reach user management even by hand-crafting the request.
export const prefix = '/api/v1/admin/users';

const email = z.string().trim().toLowerCase().pipe(z.email());
const role = z.enum(['player', 'maker', 'admin']);

const AddUserBody = z.object({ email, role, gameId: z.string().min(1).optional() }).strict();
const PatchUserBody = z.object({ role }).strict();
const WeeklyBudgetBody = z
  .object({ newGames: z.number().int().nonnegative().nullable(), edits: z.number().int().nonnegative().nullable() })
  .strict();
const InviteBody = z.object({ gameId: z.string().min(1).optional() }).strict();

type Caller = { actor: Actor; email: string };

function admin(c: Context<ApiBindings>): Caller {
  const principal = requirePrincipal(c, ['user']);
  const actor = actorFromPrincipal(principal);
  requireAuthorization(authorize(actor, 'admin.members.manage', { familyId: actor.familyId }));
  const row = c
    .get('deps')
    .db.select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, actor.userId))
    .get();
  return { actor, email: normalizeEmail(row?.email ?? '') };
}

// The invited address signs in through the same magic-link endpoint the browser posts to. The link
// lands on the instance's games screen, or on the game the admin named.
async function sendInvite(deps: AppDeps, address: string, gameId?: string): Promise<void> {
  const auth = authContextFor(deps);
  if (!auth) throw new HttpError(503, 'mail_sender_unavailable');
  const callback = new URL(gameId ? `/g/${encodeURIComponent(gameId)}` : '/games', deps.config.appOrigin);
  const response = await auth.auth.handler(
    new Request(new URL('/auth/sign-in/magic-link', deps.config.appOrigin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: deps.config.appOrigin },
      body: JSON.stringify({ email: address, callbackURL: callback.href }),
    }),
  );
  if (!response.ok) {
    deps.log({ event: 'admin-invite-mail-failed', reason: `status_${response.status}` });
    throw new HttpError(502, 'mail_failed');
  }
}

function requireFamilyGame(deps: AppDeps, familyId: string, gameId: string): void {
  const game = deps.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(and(eq(schema.games.id, gameId), eq(schema.games.familyId, familyId)))
    .get();
  if (!game) throw new HttpError(404, 'game_not_found');
}

const routes = new Hono<ApiBindings>()
  .get('/', (c) => {
    admin(c);
    const db = c.get('deps').db;
    return c.json({
      users: listAllowedUsers(db).map((user) => ({ ...user, weeklyBudget: weeklyLimits(db, user.email, user.role) })),
    });
  })
  .post('/', async (c) => {
    const { actor } = admin(c);
    const deps = c.get('deps');
    const body = await parseBody(c, AddUserBody);
    if (body.gameId) requireFamilyGame(deps, actor.familyId, body.gameId);
    const added = addAllowedUser(deps.db, { email: body.email, role: body.role, addedBy: actor.userId });
    if (!added) throw new HttpError(409, 'email_already_listed');
    await sendInvite(deps, added.email, body.gameId);
    return c.json({ user: added }, 201);
  })
  .patch('/:email', async (c) => {
    const { email: callerEmail } = admin(c);
    const body = await parseBody(c, PatchUserBody);
    const address = normalizeEmail(c.req.param('email'));
    const deps = c.get('deps');
    if (address === callerEmail && body.role !== 'admin') throw new HttpError(409, 'self_demote');
    if (!setAllowedRole(deps.db, address, body.role)) throw new HttpError(404, 'user_not_found');
    return c.json({ user: listAllowedUsers(deps.db).find((row) => row.email === address) });
  })
  .put('/:email/weekly-budget', async (c) => {
    admin(c);
    const db = c.get('deps').db;
    const address = normalizeEmail(c.req.param('email'));
    if (roleForEmail(db, address) === null) throw new HttpError(404, 'user_not_found');
    const budget = await parseBody(c, WeeklyBudgetBody);
    if (energyProbeOwnsEmail(db, address)) throw new HttpError(409, 'qa_energy_probe_active');
    db.insert(schema.weeklyJobBudgets)
      .values({ email: address, ...budget })
      .onConflictDoUpdate({ target: schema.weeklyJobBudgets.email, set: budget })
      .run();
    return c.json({ weeklyBudget: budget });
  })
  .delete('/:email', (c) => {
    const { email: callerEmail } = admin(c);
    const address = normalizeEmail(c.req.param('email'));
    if (address === callerEmail) throw new HttpError(409, 'self_remove');
    if (energyProbeOwnsEmail(c.get('deps').db, address)) throw new HttpError(409, 'qa_energy_probe_active');
    if (!removeAllowedUser(c.get('deps').db, address)) throw new HttpError(404, 'user_not_found');
    return c.body(null, 204);
  })
  .post('/:email/invite', async (c) => {
    const { actor } = admin(c);
    const deps = c.get('deps');
    const address = normalizeEmail(c.req.param('email'));
    const body = await parseBody(c, InviteBody);
    // The invite re-checks the address, so a resend can never mail someone the list does not hold.
    if (roleForEmail(deps.db, address) === null) throw new HttpError(404, 'user_not_found');
    if (body.gameId) requireFamilyGame(deps, actor.familyId, body.gameId);
    await sendInvite(deps, address, body.gameId);
    return c.json({ invited: address });
  });

export default routes;
