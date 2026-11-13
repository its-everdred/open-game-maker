import { Hono } from 'hono';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';

import type { ApiBindings } from '../app/types.js';
import { FsBaseDocSource } from '../design/base-doc.js';
import { snapshotAt } from '../design/snapshot.js';
import { BranchNotFound, resolveBranch } from '../design/store.js';
import type { HookIdentityResolver } from './bundle.js';

/** A daemon receives only the effective design of its own game's ticket. */
export function agentDesignRoutes(opts: { identityForSecret: HookIdentityResolver }) {
  return new Hono<ApiBindings>().get('/jobs/by-ticket/:identifier/design', async (c) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    const deps = c.get('deps');
    const identity = bearer ? await opts.identityForSecret(bearer[1]!, deps) : null;
    if (!identity) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const job = await deps.registry.ticketJobResolver?.(identity.repo, c.req.param('identifier'));
    if (!job || job.repo.toLowerCase() !== identity.repo.toLowerCase()) {
      return c.json({ error: { code: 'not_found' } }, 404);
    }
    const row = deps.db
      .select({ gameId: schema.jobs.gameId, branchId: schema.jobs.branchId, slug: schema.games.slug })
      .from(schema.jobs)
      .innerJoin(schema.games, eq(schema.games.id, schema.jobs.gameId))
      .where(eq(schema.jobs.id, job.jobId))
      .get();
    if (!row || row.gameId !== job.gameId || row.slug !== identity.slug) {
      return c.json({ error: { code: 'not_found' } }, 404);
    }
    try {
      const branch = resolveBranch(deps.sqlite, row.gameId, row.branchId);
      const snapshot = await snapshotAt(deps.sqlite, new FsBaseDocSource(deps.config.gamesRoot), branch.id);
      c.header('cache-control', 'no-store');
      return c.json(snapshot);
    } catch (error) {
      if (error instanceof BranchNotFound) return c.json({ error: { code: 'not_found' } }, 404);
      throw error;
    }
  });
}
