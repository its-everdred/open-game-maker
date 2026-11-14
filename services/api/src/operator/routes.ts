import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { and, eq } from 'drizzle-orm';

import { reviewPath } from '@ogm/contracts';
import { schema } from '@ogm/db';

import { HttpError } from '../app/errors.js';
import { hasInternalCredential } from '../app/internal-auth.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { ARCHIVE_LIMITS } from '../builds/untar.js';
import { findGameBySlugOrId } from '../games/slug.js';
import { reviewNumber } from '../reviews/numbers.js';
import { parseBody } from '../app/validate.js';
import { gameResponse } from '../games/games.js';
import { OperatorRegisterBody, registerOperatorGame } from './register.js';
import { publishArchive } from './publish.js';
import { reviewStalls } from '../review-rounds/stalls.js';
import { reconcileStale } from '../review-rounds/heartbeat.js';
import { reviewAllowsClose } from '../review-rounds/close-gate.js';
import { phaseOwner } from '../review-rounds/owners.js';
import { listTracks } from '../review-rounds/tracks.js';

// An operator's route to publish a build for a game the app registered against a repository whose own tickets are
// not Game Maker jobs — the daemon's `before_remove` hook never runs for them, so nothing ever uploads a build.
// Nothing here is reachable with a user session: the caller presents the internal token in its own header, as the
// New Game routes do. A game's facts come first, so the host script knows where to build before it uploads.
export const prefix = '/internal/operator';

const SHA = /^[0-9a-f]{40}$/u;

function requireOperator(c: Context<ApiBindings>): void {
  if (!hasInternalCredential(c)) throw new HttpError(401, 'unauthenticated');
}

function gameFor(deps: AppDeps, ref: string) {
  const game = findGameBySlugOrId(deps.db, ref);
  if (!game) throw new HttpError(404, 'game_not_found');
  return game;
}

// What the host script needs to build the game at a SHA and to say what it is replacing: the game's folder in the
// instance repository, the checkout the daemon row registered and the build the main branch serves now.
function facts(deps: AppDeps, game: ReturnType<typeof gameFor>) {
  const ownDaemon = game.slug
    ? deps.db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, game.slug)).get()
    : undefined;
  const repoDaemons =
    game.githubOwner && game.githubRepo
      ? deps.db
          .select()
          .from(schema.gameDaemons)
          .where(eq(schema.gameDaemons.repo, `${game.githubOwner}/${game.githubRepo}`.toLowerCase()))
          .all()
      : [];
  const daemon = ownDaemon ?? (repoDaemons.length === 1 ? repoDaemons[0] : undefined);
  const branch = deps.db
    .select({ id: schema.branches.id, latestBuildId: schema.branches.latestBuildId })
    .from(schema.branches)
    .where(and(eq(schema.branches.gameId, game.id), eq(schema.branches.name, 'main')))
    .get();
  const build = branch?.latestBuildId
    ? deps.db
        .select({
          id: schema.builds.id,
          gitSha: schema.builds.gitSha,
          status: schema.builds.status,
          createdAt: schema.builds.createdAt,
        })
        .from(schema.builds)
        .where(eq(schema.builds.id, branch.latestBuildId))
        .get()
    : undefined;
  return {
    game: {
      id: game.id,
      slug: game.slug,
      title: game.title,
      repo: { owner: game.githubOwner, name: game.githubRepo, path: game.githubPath },
      repoVisibility: game.repoVisibility,
    },
    daemon: daemon
      ? {
          port: daemon.port,
          checkoutPath: daemon.checkoutPath,
          unit: daemon.unit,
          envFile: daemon.envFile,
          status: daemon.status,
        }
      : null,
    branch: branch ? { id: branch.id, name: 'main', latestBuildId: branch.latestBuildId } : null,
    build: build ?? null,
  };
}

const routes = new Hono<ApiBindings>()
  .get('/games/:ref/review-close/:ticket', async (c) => {
    requireOperator(c);
    const deps = c.get('deps');
    const game = gameFor(deps, c.req.param('ref'));
    const info = facts(deps, game);
    if (!info.daemon || !game.githubPath) throw new HttpError(503, 'review_tracks_unavailable');
    const ticket = c.req.param('ticket');
    if (!/^[1-9][0-9]*$/u.test(ticket)) throw new HttpError(400, 'invalid_ticket');
    const sha = c.req.query('sha');
    if (!sha || !SHA.test(sha)) throw new HttpError(400, 'invalid_sha');
    // Seed first-phase owners from the committed definitions before deciding that a ticket is untracked.
    for (const track of await listTracks(info.daemon.checkoutPath, game.githubPath, sha)) {
      const first = track.phases[0];
      if (first) phaseOwner(deps.db, game.id, track, first.id);
    }
    const owners = deps.db
      .select()
      .from(schema.reviewPhaseOwners)
      .where(eq(schema.reviewPhaseOwners.gameId, game.id))
      .all();
    const rounds = deps.db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.gameId, game.id)).all();
    return c.json({
      allowed: reviewAllowsClose(
        ticket,
        game.id,
        owners.map((owner) => ({ ...owner, status: '' })),
        rounds,
      ),
    });
  })
  .get('/review-health', (c) => {
    requireOperator(c);
    const deps = c.get('deps');
    return c.json({ stale: reconcileStale(deps.db, Date.now(), deps.config.commandPollMs ?? 5000) });
  })
  .get('/review-stalls', (c) => {
    requireOperator(c);
    return c.json(reviewStalls(c.get('deps').db, Date.now()));
  })
  .post('/games', async (c) => {
    requireOperator(c);
    const result = registerOperatorGame(c.get('deps'), await parseBody(c, OperatorRegisterBody));
    return c.json(gameResponse(result.game), result.created ? 201 : 200);
  })
  .get('/games/:ref', (c) => {
    requireOperator(c);
    const deps = c.get('deps');
    return c.json(facts(deps, gameFor(deps, c.req.param('ref'))));
  })
  // The Executor's link builder (#591): the short `/<slug>/review/<n>` path for one of the game's aiur decisions. A
  // decision not shown before takes the game's next number here, so the link it pushes is the one the inbox shows.
  .get('/games/:ref/reviews/:decisionId', (c) => {
    requireOperator(c);
    const deps = c.get('deps');
    const game = gameFor(deps, c.req.param('ref'));
    if (game.slug === null) throw new HttpError(409, 'game_slug_missing');
    const number = reviewNumber(deps.db, game.id, c.req.param('decisionId'));
    return c.json({ number, path: reviewPath(game.slug, number) });
  })
  // The operator's host script builds the game and posts the same archive the daemon's hook uploads, so the publisher
  // reads one artifact shape. A second run with a newer SHA stages and publishes the next build.
  .post(
    '/games/:ref/builds',
    async (c, next) => {
      requireOperator(c);
      await next();
    },
    bodyLimit({
      maxSize: ARCHIVE_LIMITS.compressedBytes,
      onError: (c) => c.json({ error: { code: 'archive_too_large' } }, 413),
    }),
    async (c) => {
      const deps = c.get('deps');
      const game = gameFor(deps, c.req.param('ref'));
      const gitSha = c.req.header('x-gm-sha') ?? '';
      if (!SHA.test(gitSha)) return c.json({ error: { code: 'invalid_sha' } }, 400);
      const result = await publishArchive(deps, game, gitSha, Buffer.from(await c.req.arrayBuffer()));
      if (result.state === 'refused') {
        deps.log({ event: 'build_upload_refused', jobId: result.jobId, gameId: game.id, reason: result.reason });
        return c.json({ error: { code: result.reason } }, 422);
      }
      return result.state === 'done'
        ? c.json({ state: 'done', jobId: result.jobId, buildId: result.buildId }, 201)
        : c.json({ state: 'failed', jobId: result.jobId, reason: result.reason }, 422);
    },
  );

export default routes;
