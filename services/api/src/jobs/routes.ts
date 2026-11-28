import { Hono } from 'hono';
import { z } from 'zod';

import { CreateJobRequest, Id, JobPlan, MicroUsd } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { eq } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { hasGameGrant, listGames as listVisibleGames } from '../games/games.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody, parseQuery } from '../app/validate.js';
import { AdmissionRefused, admit } from './admission.js';
import { isEnergyProbe } from '../qa/energy-probe.js';
import { createControlsRoutes, storedDaemonFor } from './controls.js';
import { findJob, findJobRow, listJobs } from './repo.js';
import { raiseCap } from './spend-cap.js';
import { isTerminal } from './state.js';

export const prefix = '/api/v1';

const listQuery = z.union([z.object({ gameId: Id }).strict(), z.object({ state: z.literal('active') }).strict()]);
const patchBody = z.object({ plan: JobPlan }).strict();
const raiseBody = z.object({ amountMicroUsd: MicroUsd }).strict();

function defaults(deps: AppDeps) {
  return {
    dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
    defaultAllowanceConfigured: deps.config.defaultDailyAllowanceConfigured,
    resetZone: deps.config.resetZoneDefault,
  };
}

function gameFor(deps: AppDeps, gameId: string) {
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, gameId)).get();
  if (!game) throw new HttpError(404, 'game_not_found');
  return game;
}

function requireRead(deps: AppDeps, gameId: string, actor: ReturnType<typeof actorFromPrincipal>) {
  const game = gameFor(deps, gameId);
  requireAuthorization(
    authorize(actor, 'game.play', {
      familyId: game.familyId,
      ownerId: game.ownerId,
      visibility: game.visibility,
      releaseState: game.releaseState,
      granted: hasGameGrant(deps.db, game.id, actor.userId),
    }),
  );
  return game;
}

const routes = new Hono<ApiBindings>()
  .post('/jobs', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const body = await parseBody(c, CreateJobRequest);
    if (body.kind === 'scope') throw new HttpError(403, 'scope_job_not_allowed');
    const deps = c.get('deps');
    try {
      return c.json(
        await admit(
          {
            db: deps.db,
            sqlite: deps.sqlite,
            events: deps.events,
            defaults: defaults(deps),
            qaEnergyProbe: isEnergyProbe(c, principal.userId),
          },
          body,
          actorFromPrincipal(principal),
        ),
        202,
      );
    } catch (error) {
      if (error instanceof AdmissionRefused) return c.json(error.body, 402);
      throw error;
    }
  })
  .get('/jobs', (c) => {
    const principal = requirePrincipal(c, ['user']);
    const query = parseQuery(c, listQuery);
    const deps = c.get('deps');
    const actor = actorFromPrincipal(principal);
    if ('gameId' in query) {
      requireRead(deps, query.gameId, actor);
      return c.json({ jobs: listJobs(deps.db, query.gameId) });
    }

    requireAuthorization(authorize(actor, 'game.play', { familyId: principal.familyId, visibility: 'listed' }));
    const visibleGameIds = listVisibleGames(deps.db, principal.familyId, principal.userId)
      .filter(
        (game) =>
          authorize(actor, 'game.play', {
            familyId: game.familyId,
            ownerId: game.ownerId,
            visibility: game.visibility,
            releaseState: game.releaseState,
            granted: hasGameGrant(deps.db, game.id, principal.userId),
          }).ok,
      )
      .map((game) => game.id);
    const jobs = listJobs(deps.db, visibleGameIds).filter((job) => !isTerminal(job.state));
    return c.json({ jobs });
  })
  .get('/jobs/:id', (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const row = findJobRow(deps.db, c.req.param('id'));
    requireRead(deps, row.gameId, actorFromPrincipal(principal));
    return c.json(findJob(deps.db, row.id));
  })
  .patch('/jobs/:id', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const row = findJobRow(deps.db, c.req.param('id'));
    const game = gameFor(deps, row.gameId);
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.edit', { familyId: game.familyId, ownerId: game.ownerId }),
    );
    if (row.state !== 'queued') throw new HttpError(409, 'job_not_queued');
    const { plan } = await parseBody(c, patchBody);
    deps.db
      .update(schema.jobs)
      .set({ plan: JSON.stringify(plan), updatedAt: new Date().toISOString() })
      .where(eq(schema.jobs.id, row.id))
      .run();
    return c.json(findJob(deps.db, row.id));
  })
  .post('/jobs/:id/raise-cap', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const row = findJobRow(deps.db, c.req.param('id'));
    requireAuthorization(authorize(actorFromPrincipal(principal), 'admin.budget.set', { familyId: row.familyId }));
    if (row.aiurRepo === null) throw new HttpError(409, 'job_not_filed');
    const { amountMicroUsd } = await parseBody(c, raiseBody);
    const aiur = await deps.aiurClientForGame(row.gameId);
    return c.json(
      await raiseCap(
        { db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults: defaults(deps) },
        row.id,
        amountMicroUsd,
        aiur,
      ),
    );
  });

routes.route(
  '/jobs',
  createControlsRoutes({ daemonFor: storedDaemonFor, issues: (deps) => deps.registry.issueStateWriter }),
);

export default routes;
