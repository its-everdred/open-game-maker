import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { and, eq, sql } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import { invalidateArtifactGrants } from '../artifacts/session-grants.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { findGameForFamily, hasGameGrant } from '../games/games.js';

export const prefix = '/api/v1/games';
const bodySchema = z.object({ access: z.enum(['hide', 'play', 'edit']) }).strict();

const routes = new Hono<ApiBindings>()
  .get('/:gameId/access', (c) => {
    const principal = requirePrincipal(c, ['user']);
    const { db } = c.get('deps');
    const game = findGameForFamily(db, c.req.param('gameId'), principal.familyId);
    if (game.ownerId !== principal.userId) throw new HttpError(403, 'not_owner');
    const users = db
      .select({
        email: schema.allowedUsers.email,
        role: schema.allowedUsers.role,
        name: schema.user.name,
        userId: schema.user.id,
        familyId: schema.familyMembers.familyId,
        access: schema.gameAccess.access,
      })
      .from(schema.allowedUsers)
      .leftJoin(schema.user, sql`lower(${schema.user.email}) = ${schema.allowedUsers.email}`)
      .leftJoin(schema.familyMembers, eq(schema.familyMembers.userId, schema.user.id))
      .leftJoin(
        schema.gameAccess,
        and(eq(schema.gameAccess.email, schema.allowedUsers.email), eq(schema.gameAccess.gameId, game.id)),
      )
      .all();
    return c.json({
      users: users.map((user) => ({
        ...user,
        access:
          user.access ??
          (user.userId &&
          authorize(
            {
              userId: user.userId,
              familyId: user.familyId ?? '',
              platformRole: user.role === 'admin' ? 'admin' : 'none',
              capability: user.role === 'player' ? 'player' : 'creator',
            },
            'game.play',
            {
              familyId: game.familyId,
              ownerId: game.ownerId,
              visibility: game.visibility,
              releaseState: game.releaseState,
              granted: hasGameGrant(db, game.id, user.userId),
            },
          ).ok
            ? 'play'
            : 'hide'),
      })),
    });
  })
  .put('/:gameId/access/:email', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const { db } = c.get('deps');
    const game = findGameForFamily(db, c.req.param('gameId'), principal.familyId);
    if (game.ownerId !== principal.userId) throw new HttpError(403, 'not_owner');
    const email = c.req.param('email').trim().toLowerCase();
    const target = db.select().from(schema.allowedUsers).where(eq(schema.allowedUsers.email, email)).get();
    if (!target) throw new HttpError(404, 'user_not_found');
    const account = db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(sql`lower(${schema.user.email}) = ${email}`)
      .get();
    if (account?.id === game.ownerId) throw new HttpError(409, 'owner_immutable');
    const { access } = await parseBody(c, bodySchema);
    if (access === 'edit' && target.role === 'player') throw new HttpError(400, 'editor_required');
    const updated = { access, updatedBy: principal.userId, updatedAt: new Date().toISOString() };
    db.transaction((tx) => {
      const previous = tx
        .select({ access: schema.gameAccess.access })
        .from(schema.gameAccess)
        .where(and(eq(schema.gameAccess.gameId, game.id), eq(schema.gameAccess.email, email)))
        .get();
      if (previous?.access === access) return;
      tx.insert(schema.gameAccess)
        .values({ gameId: game.id, email, ...updated })
        .onConflictDoUpdate({ target: [schema.gameAccess.gameId, schema.gameAccess.email], set: updated })
        .run();
      tx.insert(schema.gameAccessAudit)
        .values({
          id: randomUUID(),
          gameId: game.id,
          email,
          previousAccess: previous?.access ?? null,
          access,
          actorId: principal.userId,
          createdAt: updated.updatedAt,
        })
        .run();
      if (account) invalidateArtifactGrants(tx, 'user', account.id);
    });
    return c.json({ email, access });
  });

export default routes;
