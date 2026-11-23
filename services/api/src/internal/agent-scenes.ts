import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { SceneDocSchema, SceneHeadSchema, SceneIdSchema, SceneRevisionSchema } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { InvalidSceneError, SceneBaseUnavailableError } from '@ogm/design-log';

import type { ApiBindings } from '../app/types.js';
import { findGameForFamily } from '../games/games.js';
import { sharedScene } from '../scenes/routes.js';
import { seedScene, writeScene } from '../scenes/store.js';
import type { HookIdentityResolver } from './bundle.js';

const PushSchema = z.strictObject({
  baseRev: z.number().int().nonnegative(),
  doc: SceneDocSchema,
  label: z.string().max(200).optional(),
});
const SeedSchema = z.strictObject({ head: SceneHeadSchema, log: z.array(SceneRevisionSchema) });

/**
 * `gm scene pull`/`push` for a daemon's own ticket (#1209): agents read and write the same shared scene store the
 * map maker saves Kevin's edits to, always as `agent:<ticket>` from the `cli` source.
 */
export function agentSceneRoutes(opts: { identityForSecret: HookIdentityResolver }) {
  async function target(c: Context<ApiBindings>) {
    const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    const deps = c.get('deps');
    const identity = bearer ? await opts.identityForSecret(bearer[1]!, deps) : null;
    if (!identity) return { error: c.json({ error: { code: 'unauthenticated' } }, 401) };
    const ticket = c.req.param('identifier') ?? '';
    const scene = SceneIdSchema.safeParse(c.req.param('scene'));
    const job = /^[1-9]\d{0,15}$/.test(ticket)
      ? await deps.registry.ticketJobResolver?.(identity.repo, ticket)
      : undefined;
    if (!scene.success || !job || job.repo.toLowerCase() !== identity.repo.toLowerCase()) {
      return { error: c.json({ error: { code: 'not_found' } }, 404) };
    }
    const row = deps.db
      .select({ gameId: schema.jobs.gameId, familyId: schema.games.familyId, slug: schema.games.slug })
      .from(schema.jobs)
      .innerJoin(schema.games, eq(schema.games.id, schema.jobs.gameId))
      .where(eq(schema.jobs.id, job.jobId))
      .get();
    if (!row || row.gameId !== job.gameId || row.slug !== identity.slug) {
      return { error: c.json({ error: { code: 'not_found' } }, 404) };
    }
    const game = findGameForFamily(deps.db, row.gameId, row.familyId);
    return { game, scene: scene.data, author: `agent:${ticket}` as const };
  }

  return new Hono<ApiBindings>()
    .get('/jobs/by-ticket/:identifier/scenes/:scene', async (c) => {
      const found = await target(c);
      if ('error' in found) return found.error;
      const store = await sharedScene(c, found.game, found.scene);
      c.header('cache-control', 'no-store');
      if (!store) return c.json({ error: { code: 'not_found' } }, 404);
      return c.json(store);
    })
    .post('/jobs/by-ticket/:identifier/scenes/:scene/seed', async (c) => {
      const found = await target(c);
      if ('error' in found) return found.error;
      const body = SeedSchema.safeParse(await c.req.json().catch(() => undefined));
      if (!body.success || body.data.head.doc.scene !== found.scene || body.data.log.length !== body.data.head.rev) {
        return c.json({ error: { code: 'invalid_request' } }, 400);
      }
      c.header('cache-control', 'no-store');
      return c.json(seedScene(c.get('deps').db, found.game.id, body.data, new Date()));
    })
    .post('/jobs/by-ticket/:identifier/scenes/:scene', async (c) => {
      const found = await target(c);
      if ('error' in found) return found.error;
      const body = PushSchema.safeParse(await c.req.json().catch(() => undefined));
      if (!body.success || body.data.doc.scene !== found.scene) {
        return c.json({ error: { code: 'invalid_request' } }, 400);
      }
      try {
        const result = writeScene(c.get('deps').db, found.game.id, {
          doc: body.data.doc,
          baseRev: body.data.baseRev,
          author: found.author,
          source: 'cli',
          label: body.data.label ?? '',
          now: new Date(),
        });
        c.header('cache-control', 'no-store');
        return c.json(result);
      } catch (error) {
        if (error instanceof InvalidSceneError || error instanceof SceneBaseUnavailableError) {
          return c.json({ error: { code: 'scene_refused', message: error.message } }, 409);
        }
        throw error;
      }
    });
}
