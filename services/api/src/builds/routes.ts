import { homedir } from 'node:os';

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { ApiBindings } from '../app/types.js';
import { hookSecretFiles, hookSecretGame, type HookDaemonResolver, type HookGameResolver } from '../internal/bundle.js';
import { findGameBySlugOrId } from '../games/slug.js';
import { createPreview } from '../previews/store.js';
import { BuildCacheError } from './cache-plan.js';
import { awaitsBuild, isPublishing, publishStaged, runCompleted, stageArtifact } from './publish.js';
import { ARCHIVE_LIMITS, BadArchive } from './untar.js';

// The game repo's `before_remove` hook uploads its sandboxed build here with its daemon's hook secret.
export const prefix = '/internal';

const SHA = /^[0-9a-f]{40}$/u;

export function buildRoutes(opts: { daemonForSecret: HookDaemonResolver; gameForSecret?: HookGameResolver }) {
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
        try {
          const preview = await createPreview(
            deps,
            game.id,
            c.req.param('identifier'),
            sha,
            Buffer.from(await c.req.arrayBuffer()),
          );
          return c.json({ gameId: preview.gameId, buildId: preview.buildId }, 201);
        } catch (error) {
          if (error instanceof BadArchive || error instanceof BuildCacheError)
            return c.json({ error: { code: error.message } }, 422);
          throw error;
        }
      },
    );
}

export default buildRoutes({ daemonForSecret: hookSecretFiles(homedir()), gameForSecret: hookSecretGame(homedir()) });
