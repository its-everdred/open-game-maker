import { Hono } from 'hono';
import { z } from 'zod';

import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { and, eq } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { acceptInvitation, createInvitation, invitationResponse } from './invites.js';

export const prefix = '/api/v1';

const createBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), email: z.email(), capability: z.enum(['creator', 'player']) }).strict(),
  z.object({ kind: z.literal('play'), email: z.email(), gameId: z.string().min(1) }).strict(),
  z
    .object({ kind: z.literal('room'), email: z.email(), gameId: z.string().min(1), roomId: z.string().min(1) })
    .strict(),
]);

const routes = new Hono<ApiBindings>()
  .post('/invites', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const body = await parseBody(c, createBody);
    const created = await createInvitation(c.get('deps'), actorFromPrincipal(principal), body);
    return c.json({ id: created.id, expiresAt: created.expiresAt }, 201);
  })
  .get('/invites', (c) => {
    const principal = requirePrincipal(c, ['user']);
    const actor = actorFromPrincipal(principal);
    requireAuthorization(authorize(actor, 'member.invite', { familyId: actor.familyId, inviteKind: 'play' }));
    const family = eq(schema.invitations.familyId, actor.familyId);
    const where = actor.platformRole === 'admin' ? family : and(family, eq(schema.invitations.inviterId, actor.userId));
    return c.json({
      invitations: c.get('deps').db.select().from(schema.invitations).where(where).all().map(invitationResponse),
    });
  })
  .post('/invites/:token/accept', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    return c.json(await acceptInvitation(c.get('deps'), c.req.param('token'), principal.userId));
  })
  .delete('/invites/:id', (c) => {
    const principal = requirePrincipal(c, ['user']);
    const actor = actorFromPrincipal(principal);
    const invitation = c
      .get('deps')
      .db.select()
      .from(schema.invitations)
      .where(and(eq(schema.invitations.id, c.req.param('id')), eq(schema.invitations.familyId, actor.familyId)))
      .get();
    if (!invitation) throw new HttpError(404, 'invite_not_found');
    requireAuthorization(
      authorize(actor, 'member.invite', { familyId: invitation.familyId, inviteKind: invitation.kind }),
    );
    if (actor.platformRole !== 'admin' && invitation.inviterId !== actor.userId) {
      throw new HttpError(403, 'not_inviter');
    }
    c.get('deps')
      .db.update(schema.invitations)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(schema.invitations.id, invitation.id))
      .run();
    return c.body(null, 204);
  });

export default routes;
