import { Hono } from 'hono';
import { z } from 'zod';

import { authorize } from '@ogm/policy';

import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { actorFromPrincipal, createFamily, familyForUser, listMembers, requireAuthorization } from './families.js';

export const prefix = '/api/v1';

const createFamilyBody = z.object({ name: z.string().trim().min(1).max(80) }).strict();

const routes = new Hono<ApiBindings>()
  .get('/me', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const directory = c.get('deps').registry.userDirectory;
    if (!directory) throw new HttpError(503, 'user_directory_unavailable');
    const email = await directory.emailForUser(principal.userId);
    if (!email) throw new HttpError(503, 'user_directory_unavailable');
    return c.json({
      user: { id: principal.userId, email },
      family: familyForUser(c.get('deps').db, principal.userId) ?? null,
      platformRole: principal.platformRole,
      capability: principal.capability,
    });
  })
  .post('/families', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const body = await parseBody(c, createFamilyBody);
    return c.json(createFamily(c.get('deps').db, { userId: principal.userId, name: body.name }), 201);
  })
  .get('/families/:id/members', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const familyId = c.req.param('id');
    requireAuthorization(authorize(actorFromPrincipal(principal), 'admin.members.manage', { familyId }));
    const directory = c.get('deps').registry.userDirectory;
    if (!directory) throw new HttpError(503, 'user_directory_unavailable');
    const members = await Promise.all(
      listMembers(c.get('deps').db, familyId).map(async (member) => ({
        ...member,
        email: await directory.emailForUser(member.userId),
      })),
    );
    return c.json({ members });
  });

export default routes;
