import { createHash, timingSafeEqual } from 'node:crypto';

import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { createRoomInvitation, recordRoomEnded, revokeRoomAccess } from './rooms.js';

export const prefix = '/';

const invitationBody = z.object({ email: z.email().optional() }).strict();
const revokeBody = z
  .object({ jti: z.string().min(1).optional(), userId: z.string().min(1).optional() })
  .strict()
  .refine((body) => body.jti !== undefined || body.userId !== undefined);
const endedBody = z
  .object({
    reason: z.enum(['host-left', 'owner-closed', 'idle', 'revoked']),
    endedAt: z.iso.datetime(),
  })
  .strict();

function requireRoomsSecret(c: Context<ApiBindings>): void {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
  if (!match) throw new HttpError(401, 'unauthenticated');
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(match[1]), digest(c.get('deps').config.roomsInternalSecret))) {
    throw new HttpError(401, 'unauthenticated');
  }
}

const routes = new Hono<ApiBindings>()
  .post('/api/v1/rooms/:roomId/invites', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    return c.json(
      await createRoomInvitation(c.get('deps'), principal, c.req.param('roomId'), await parseBody(c, invitationBody)),
      201,
    );
  })
  .post('/api/v1/rooms/:roomId/revoke', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    await revokeRoomAccess(c.get('deps'), principal, c.req.param('roomId'), await parseBody(c, revokeBody));
    return c.body(null, 204);
  })
  .post('/internal/rooms/:roomId/ended', async (c) => {
    requireRoomsSecret(c);
    recordRoomEnded(c.get('deps'), c.req.param('roomId'), await parseBody(c, endedBody));
    return c.body(null, 204);
  });

export default routes;
