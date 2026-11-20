import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { and, eq, sql } from 'drizzle-orm';

import { ReviewSubmission, reviewPath } from '@ogm/contracts';
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
import { PUBLISH_ACTOR, publishArchive } from './publish.js';
import { reviewStalls } from '../review-rounds/stalls.js';
import { reconcileStale } from '../review-rounds/heartbeat.js';
import { reviewAllowsClose, reviewApprovalsSettled } from '../review-rounds/close-gate.js';
import { phaseOwner } from '../review-rounds/owners.js';
import { listTracks, reviewCheckout } from '../review-rounds/tracks.js';
import { reviewDaemonForGame } from '../review-rounds/daemon.js';
import { ensureCommit } from './ensure-commit.js';
import { submitRound } from '../review-rounds/store.js';
import { logReviewPublish } from '../review-rounds/feed-log.js';
import { isReviewStill } from '../review-rounds/still.js';

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
  const latestPrototypeReview = deps.db
    .select({ id: schema.reviewRounds.id, sha: schema.reviewRounds.sha, postedAt: schema.reviewRounds.postedAt })
    .from(schema.reviewRounds)
    .where(and(eq(schema.reviewRounds.gameId, game.id), eq(schema.reviewRounds.track, 'prototype-publish')))
    .orderBy(sql`julianday(${schema.reviewRounds.postedAt}) DESC`, sql`rowid DESC`)
    .get();
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
    latestPrototypeReview: latestPrototypeReview ?? null,
  };
}

const routes = new Hono<ApiBindings>()
  .get('/games/:ref/review-close/:ticket', async (c) => {
    requireOperator(c);
    const deps = c.get('deps');
    const game = gameFor(deps, c.req.param('ref'));
    const daemon = reviewDaemonForGame(deps.db, game.id);
    if (!daemon || !game.githubPath) throw new HttpError(503, 'review_tracks_unavailable');
    const ticket = c.req.param('ticket');
    if (!/^[1-9][0-9]*$/u.test(ticket)) throw new HttpError(400, 'invalid_ticket');
    const sha = c.req.query('sha');
    if (!sha || !SHA.test(sha)) throw new HttpError(400, 'invalid_sha');
    const checkout = await reviewCheckout(daemon.checkoutPath, ticket, daemon.repo);
    await ensureCommit(checkout, sha);
    // Seed first-phase owners from the committed definitions before deciding that a ticket is untracked.
    const reviewedTracks = await listTracks(checkout, game.githubPath, sha);
    const currentTracks = await listTracks(checkout, game.githubPath);
    for (const track of [...reviewedTracks, ...currentTracks]) {
      const first = track.phases[0];
      if (first) phaseOwner(deps.db, game.id, track, first.id);
    }
    const owners = deps.db
      .select()
      .from(schema.reviewPhaseOwners)
      .where(eq(schema.reviewPhaseOwners.gameId, game.id))
      .all();
    const rounds = deps.db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.gameId, game.id)).all();
    const intents = deps.db
      .select()
      .from(schema.reviewDispatchIntents)
      .where(eq(schema.reviewDispatchIntents.ticket, ticket))
      .all();
    return c.json({
      allowed:
        reviewApprovalsSettled(ticket, rounds, intents) &&
        reviewAllowsClose(
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
  .post(
    '/games/:ref/prototype-reviews/media',
    async (c, next) => {
      requireOperator(c);
      await next();
    },
    bodyLimit({ maxSize: 64 * 1024 * 1024, onError: (c) => c.json({ error: { code: 'media_too_large' } }, 413) }),
    async (c) => {
      const game = gameFor(c.get('deps'), c.req.param('ref'));
      const mime = c.req.header('content-type')?.split(';')[0]?.trim();
      if (mime !== 'video/mp4' && mime !== 'image/png') return c.json({ error: { code: 'invalid_media_type' } }, 415);
      const bytes = Buffer.from(await c.req.arrayBuffer());
      if (!bytes.length) return c.json({ error: { code: 'empty_media' } }, 400);
      const { hash } = await c.get('deps').blobStore.put(bytes, mime);
      return c.json({ gameId: game.id, hash, bytes: bytes.length }, 201);
    },
  )
  .post('/games/:ref/prototype-reviews', async (c) => {
    requireOperator(c);
    const deps = c.get('deps');
    const game = gameFor(deps, c.req.param('ref'));
    const parsed = ReviewSubmission.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_review', details: parsed.error.issues } }, 400);
    const submission = parsed.data;
    if (
      submission.track !== 'prototype-publish' ||
      submission.phase !== 'build' ||
      submission.category !== 'gameplay' ||
      (submission.sourceTickets?.length
        ? submission.ticket !== submission.sourceTickets[0]
        : submission.ticket !== 'publish')
    )
      return c.json({ error: { code: 'invalid_prototype_review' } }, 400);
    const build = deps.db
      .select()
      .from(schema.builds)
      .where(eq(schema.builds.id, String(submission.media.find((item) => item.kind === 'build')?.ref)))
      .get();
    if (!build || build.gameId !== game.id || build.gitSha !== submission.sha || build.status !== 'tested')
      return c.json({ error: { code: 'published_build_not_found' } }, 404);
    for (const media of submission.media) {
      if (media.kind === 'clip') {
        const stored = await deps.blobStore.head(media.ref as never);
        if (!stored || stored.mime !== 'video/mp4') return c.json({ error: { code: 'review_media_invalid' } }, 422);
      } else if (media.kind === 'still') {
        const stored = await deps.blobStore.head(media.ref as never);
        if (!stored || !(await isReviewStill(deps.blobStore, media.ref)))
          return c.json({ error: { code: 'review_media_invalid' } }, 422);
      }
    }
    const existing = deps.db
      .select()
      .from(schema.reviewRounds)
      .where(
        and(
          eq(schema.reviewRounds.gameId, game.id),
          eq(schema.reviewRounds.track, 'prototype-publish'),
          sql`EXISTS (SELECT 1 FROM json_each(${schema.reviewRounds.media}) WHERE json_extract(value, '$.kind') = 'build' AND json_extract(value, '$.ref') = ${build.id})`,
        ),
      )
      .get();
    if (existing) {
      deps.db.update(schema.builds).set({ prototypeReviewState: 'posted' }).where(eq(schema.builds.id, build.id)).run();
      return c.json({ id: existing.id, round: existing.round, state: 'existing' });
    }
    const round = submitRound(deps.db, game.id, submission);
    deps.db.update(schema.builds).set({ prototypeReviewState: 'posted' }).where(eq(schema.builds.id, build.id)).run();
    await logReviewPublish(game.id, { ticket: submission.ticket, id: round.id, postedAt: round.postedAt }, deps.log);
    return c.json({ id: round.id, round: round.round, state: 'posted' }, 201);
  })
  .post('/games/:ref/builds/:buildId/prototype-review-check', (c) => {
    requireOperator(c);
    const deps = c.get('deps');
    const game = gameFor(deps, c.req.param('ref'));
    const buildId = c.req.param('buildId');
    const build = deps.db
      .select()
      .from(schema.builds)
      .where(and(eq(schema.builds.id, buildId), eq(schema.builds.gameId, game.id)))
      .get();
    if (!build || build.status !== 'tested') throw new HttpError(404, 'published_build_not_found');
    const hasRound = deps.db
      .select({ id: schema.reviewRounds.id })
      .from(schema.reviewRounds)
      .where(
        and(
          eq(schema.reviewRounds.gameId, game.id),
          eq(schema.reviewRounds.track, 'prototype-publish'),
          sql`EXISTS (SELECT 1 FROM json_each(${schema.reviewRounds.media}) WHERE json_extract(value, '$.kind') = 'build' AND json_extract(value, '$.ref') = ${buildId})`,
        ),
      )
      .get();
    const state = hasRound ? 'posted' : 'none';
    deps.db.update(schema.builds).set({ prototypeReviewState: state }).where(eq(schema.builds.id, buildId)).run();
    return c.json({ state });
  })
  .get('/prototype-review-gaps', (c) => {
    requireOperator(c);
    const gaps = c
      .get('deps')
      .db.select({ slug: schema.games.slug, buildId: schema.builds.id })
      .from(schema.builds)
      .innerJoin(schema.games, eq(schema.games.id, schema.builds.gameId))
      .where(and(eq(schema.builds.status, 'tested'), eq(schema.builds.prototypeReviewState, 'pending')))
      .all()
      .filter((gap): gap is { slug: string; buildId: string } => Boolean(gap.slug));
    return c.json({ gaps });
  })
  .get('/games/:ref/builds/:buildId/prototype-review', (c) => {
    requireOperator(c);
    const deps = c.get('deps');
    const game = gameFor(deps, c.req.param('ref'));
    const buildId = c.req.param('buildId');
    const round = deps.db
      .select({ id: schema.reviewRounds.id, round: schema.reviewRounds.round })
      .from(schema.reviewRounds)
      .where(
        and(
          eq(schema.reviewRounds.gameId, game.id),
          eq(schema.reviewRounds.track, 'prototype-publish'),
          sql`EXISTS (SELECT 1 FROM json_each(${schema.reviewRounds.media}) WHERE json_extract(value, '$.kind') = 'build' AND json_extract(value, '$.ref') = ${buildId})`,
        ),
      )
      .get();
    return c.json({ recorded: Boolean(round), ...(round ? { roundId: round.id, round: round.round } : {}) });
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
  .get('/games/:ref/builds/:jobId', (c) => {
    requireOperator(c);
    const deps = c.get('deps');
    const game = gameFor(deps, c.req.param('ref'));
    const jobId = c.req.param('jobId');
    const job = deps.db
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.gameId, game.id)))
      .get();
    if (!job || job.creatorId !== PUBLISH_ACTOR) throw new HttpError(404, 'publish_not_found');
    const build = deps.db.select().from(schema.builds).where(eq(schema.builds.jobId, jobId)).get();
    return c.json({ state: job.state, buildId: job.state === 'done' && build ? build.id : null });
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
      const requestId = c.req.header('x-gm-request-id');
      if (requestId && !/^j_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(requestId))
        return c.json({ error: { code: 'invalid_request_id' } }, 400);
      const result = await publishArchive(deps, game, gitSha, Buffer.from(await c.req.arrayBuffer()), requestId);
      if (result.state === 'refused') {
        deps.log({ event: 'build_upload_refused', jobId: result.jobId, gameId: game.id, reason: result.reason });
        return c.json({ error: { code: result.reason } }, 422);
      }
      if (result.state === 'done') {
        deps.db
          .update(schema.builds)
          .set({ prototypeReviewState: 'pending' })
          .where(and(eq(schema.builds.id, result.buildId), eq(schema.builds.prototypeReviewState, 'none')))
          .run();
        return c.json({ state: 'done', jobId: result.jobId, buildId: result.buildId }, 201);
      }
      return c.json({ state: 'failed', jobId: result.jobId, reason: result.reason }, 422);
    },
  );

export default routes;
