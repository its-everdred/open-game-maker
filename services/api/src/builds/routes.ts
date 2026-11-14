import { homedir } from 'node:os';

import { Hono, type Context } from 'hono';
import type { BlobHash } from '@ogm/blob-store';
import { ReviewSubmission, type ReviewTrack } from '@ogm/contracts';
import { bodyLimit } from 'hono/body-limit';

import type { ApiBindings } from '../app/types.js';
import { hookSecretFiles, hookSecretGame, type HookDaemonResolver, type HookGameResolver } from '../internal/bundle.js';
import { findGameBySlugOrId } from '../games/slug.js';
import { createPreview, listEditorPreviews, submitReviewRound } from '../previews/store.js';
import { getRound } from '../review-rounds/store.js';
import { isCaptureWithAudio } from '../review-rounds/audio.js';
import { isReviewStill } from '../review-rounds/still.js';
import { readTrack } from '../review-rounds/tracks.js';
import { phaseOwner } from '../review-rounds/owners.js';
import { reviewDaemonForGame } from '../review-rounds/daemon.js';
import { BuildCacheError } from './cache-plan.js';
import { awaitsBuild, isPublishing, publishStaged, runCompleted, stageArtifact } from './publish.js';
import { ARCHIVE_LIMITS, BadArchive } from './untar.js';

// The game repo's `before_remove` hook uploads its sandboxed build here with its daemon's hook secret.
export const prefix = '/internal';

const SHA = /^[0-9a-f]{40}$/u;

export function buildRoutes(opts: {
  daemonForSecret: HookDaemonResolver;
  gameForSecret?: HookGameResolver;
  trackFor?: (checkout: string, gamePath: string, sha: string, track: string) => Promise<ReviewTrack>;
}) {
  // Who is uploading for which job: a response refuses the upload before any body is read.
  async function admit(c: Context<ApiBindings>) {
    const deps = c.get('deps');
    const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    const repo = bearer ? await opts.daemonForSecret(bearer[1]!, deps) : null;
    if (!repo) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const resolver = deps.registry.ticketJobResolver;
    const job = resolver ? await resolver(repo, c.req.param('identifier') ?? '') : null;
    if (!job || job.repo.toLowerCase() !== repo.toLowerCase()) return c.json({ error: { code: 'not_found' } }, 404);
    if (!awaitsBuild(deps, job.jobId) || isPublishing(job.jobId)) {
      return c.json({ error: { code: 'job_not_awaiting_build' } }, 409);
    }
    const gitSha = c.req.header('x-gm-sha') ?? '';
    if (!SHA.test(gitSha)) return c.json({ error: { code: 'invalid_sha' } }, 400);
    return { jobId: job.jobId, gitSha };
  }

  return new Hono<ApiBindings>()
    .post(
      '/jobs/by-ticket/:identifier/build',
      async (c, next) => {
        const admitted = await admit(c);
        if (admitted instanceof Response) return admitted;
        await next();
      },
      // Caps the body even when a chunked upload carries no Content-Length.
      bodyLimit({
        maxSize: ARCHIVE_LIMITS.compressedBytes,
        onError: (c) => c.json({ error: { code: 'archive_too_large' } }, 413),
      }),
      async (c) => {
        const deps = c.get('deps');
        const admitted = await admit(c);
        if (admitted instanceof Response) return admitted;
        const { jobId, gitSha } = admitted;
        try {
          await stageArtifact(deps, jobId, gitSha, Buffer.from(await c.req.arrayBuffer()));
        } catch (error) {
          if (error instanceof BadArchive) {
            // The job keeps waiting: a later good upload can still land, else the sweep fails it after the grace.
            deps.log({ event: 'build_upload_refused', jobId, reason: error.message });
            return c.json({ error: { code: error.message } }, 422);
          }
          throw error;
        }

        // The upload can land before or after Aiur reports the merge; whichever comes second publishes.
        const outcome = runCompleted(deps, jobId) ? await publishStaged(deps, jobId) : null;
        return c.json(outcome ?? { state: 'staged' }, !outcome ? 202 : outcome.state === 'done' ? 201 : 422);
      },
    )
    .post(
      '/games/:ref/previews/:identifier',
      async (c, next) => {
        const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
        const deps = c.get('deps');
        const daemon = bearer && opts.gameForSecret ? await opts.gameForSecret(bearer[1]!, deps) : null;
        if (!daemon) return c.json({ error: { code: 'unauthenticated' } }, 401);
        const game = findGameBySlugOrId(deps.db, c.req.param('ref'));
        if (
          !game?.githubOwner ||
          !game.githubRepo ||
          findGameBySlugOrId(deps.db, daemon.slug)?.id !== game.id ||
          `${game.githubOwner}/${game.githubRepo}`.toLowerCase() !== daemon.repo.toLowerCase()
        )
          return c.json({ error: { code: 'not_found' } }, 404);
        await next();
      },
      bodyLimit({
        maxSize: ARCHIVE_LIMITS.compressedBytes,
        onError: (c) => c.json({ error: { code: 'archive_too_large' } }, 413),
      }),
      async (c) => {
        const deps = c.get('deps');
        const game = findGameBySlugOrId(deps.db, c.req.param('ref'))!;
        const sha = c.req.header('x-gm-sha') ?? '';
        if (!SHA.test(sha)) return c.json({ error: { code: 'invalid_sha' } }, 400);
        const branchId = c.req.header('x-gm-branch') ?? 'main';
        if (!/^[A-Za-z0-9_-]{1,200}$/u.test(branchId)) return c.json({ error: { code: 'invalid_branch' } }, 400);
        try {
          const preview = await createPreview(
            deps,
            game.id,
            c.req.param('identifier'),
            sha,
            Buffer.from(await c.req.arrayBuffer()),
            branchId,
          );
          return c.json({ gameId: preview.gameId, buildId: preview.buildId }, 201);
        } catch (error) {
          if (error instanceof BadArchive || error instanceof BuildCacheError)
            return c.json({ error: { code: error.message } }, 422);
          throw error;
        }
      },
    )
    .post('/games/:ref/review-rounds', bodyLimit({ maxSize: 65536 }), async (c) => {
      const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
      const deps = c.get('deps');
      const daemon = bearer && opts.gameForSecret ? await opts.gameForSecret(bearer[1]!, deps) : null;
      if (!daemon) return c.json({ error: { code: 'unauthenticated' } }, 401);
      const game = findGameBySlugOrId(deps.db, c.req.param('ref'));
      if (
        !game?.githubOwner ||
        !game.githubRepo ||
        findGameBySlugOrId(deps.db, daemon.slug)?.id !== game.id ||
        `${game.githubOwner}/${game.githubRepo}`.toLowerCase() !== daemon.repo.toLowerCase()
      )
        return c.json({ error: { code: 'not_found' } }, 404);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: { code: 'invalid_body' } }, 400);
      }
      const parsed = ReviewSubmission.safeParse(body);
      if (!parsed.success) return c.json({ error: { code: 'invalid_round', details: parsed.error.issues } }, 400);
      const daemonRow = reviewDaemonForGame(deps.db, game.id);
      if (!daemonRow || !game.githubPath) return c.json({ error: { code: 'track_checkout_unavailable' } }, 503);
      let track: ReviewTrack;
      try {
        track = await (opts.trackFor ?? readTrack)(
          daemonRow.checkoutPath,
          game.githubPath,
          parsed.data.sha,
          parsed.data.track,
        );
      } catch {
        return c.json({ error: { code: 'track_not_found' } }, 422);
      }
      if (
        track.category !== parsed.data.category ||
        !track.phases.some((phase) => phase.id === parsed.data.phase) ||
        phaseOwner(deps.db, game.id, track, parsed.data.phase) !== parsed.data.ticket
      )
        return c.json({ error: { code: 'track_owner_mismatch' } }, 422);
      if (parsed.data.category === 'art' && !getRound(deps.db, game.id, parsed.data.id)) {
        const assets = parsed.data.media.filter((media) => media.kind === 'still' || media.kind === 'clip');
        for (const asset of assets) {
          if (!/^sha256:[0-9a-f]{64}$/u.test(asset.ref))
            return c.json({ error: { code: 'review_media_invalid' } }, 422);
          const ref = await deps.blobStore.head(asset.ref as BlobHash);
          if (
            !ref ||
            (asset.kind === 'still' ? !(await isReviewStill(deps.blobStore, asset.ref)) : ref.mime !== 'video/mp4')
          )
            return c.json({ error: { code: 'review_media_invalid' } }, 422);
        }
      }
      if (parsed.data.category === 'sound' && !getRound(deps.db, game.id, parsed.data.id)) {
        const clips = parsed.data.media.filter((media) => media.kind === 'clip' && media.hasAudio);
        let valid = false;
        for (const clip of clips) {
          if (await isCaptureWithAudio(deps.blobStore, clip.ref)) {
            valid = true;
            break;
          }
        }
        if (!valid) return c.json({ error: { code: 'sound_capture_required' } }, 422);
      }
      if (parsed.data.category === 'gameplay' && !getRound(deps.db, game.id, parsed.data.id)) {
        const previews = await listEditorPreviews(deps, game.id);
        const builds = parsed.data.media.filter((media) => media.kind === 'build');
        if (
          !builds.some((build) =>
            previews.some(
              (preview) =>
                preview.buildId === build.ref &&
                preview.ticket === parsed.data.ticket &&
                preview.sha === parsed.data.sha,
            ),
          )
        )
          return c.json({ error: { code: 'preview_not_found' } }, 422);
      }
      try {
        const round = await submitReviewRound(deps, game.id, parsed.data);
        return c.json({ id: round.id, round: round.round }, 201);
      } catch (error) {
        if (error instanceof Error && error.message === 'preview_not_found')
          return c.json({ error: { code: 'preview_not_found' } }, 422);
        if (
          error instanceof Error &&
          ['review_submission_conflict', 'review_build_already_used', 'review_phase_not_ready'].includes(error.message)
        )
          return c.json({ error: { code: error.message } }, 409);
        throw error;
      }
    });
}

export default buildRoutes({ daemonForSecret: hookSecretFiles(homedir()), gameForSecret: hookSecretGame(homedir()) });
