import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import { z } from 'zod';

import { ScopeChoices, ScopeRevisionRequest, type Principal, type ScopeSession } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { eq } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import { readBoundedBody } from '../app/read-body.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { createRateLimiter } from '../auth/rate-limit.js';
import { MediaError, putCreatorImage } from '../build-chat/media.js';
import { getChatRuntime } from '../build-chat/routes.js';
import { insertChatRow } from '../build-chat/store.js';
import { AdmissionRefused, admit } from '../jobs/admission.js';
import { findJobRow } from '../jobs/repo.js';
import { markTerminal } from '../jobs/spend-cap.js';
import { scopeSessions } from './store.js';

export const prefix = '/api/v1/games';
export const MAX_CREATOR_IMAGE_BYTES = 10 * 1024 * 1024;
export const CREATOR_IMAGES_PER_MINUTE = 10;

const creates = new Map<string, Promise<unknown>>();
const imageLimiters = new WeakMap<AppDeps, ReturnType<typeof createRateLimiter>>();
const createBody = z.object({ choices: ScopeChoices }).strict();
type UserPrincipal = Extract<Principal, { kind: 'user' }>;

function defaults(deps: AppDeps) {
  return {
    dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
    resetZone: deps.config.resetZoneDefault,
  };
}

function response(session: ScopeSession) {
  return {
    sessionId: session.id,
    status: session.status,
    revision: session.revision,
    chatJobId: session.job_id,
    choices: session.choices,
    ...(session.ticket === undefined ? {} : { ticket: session.ticket }),
    ...(session.scope === undefined ? {} : { scope: session.scope }),
  };
}

function requireOwner(deps: AppDeps, session: ScopeSession, principal: UserPrincipal) {
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, session.game_id)).get();
  if (!game) throw new HttpError(404, 'game_not_found');
  requireAuthorization(
    authorize(actorFromPrincipal(principal), 'job.create', {
      familyId: game.familyId,
      ownerId: game.ownerId,
    }),
  );
  return game;
}

async function serialized<T>(gameId: string, work: () => Promise<T>): Promise<T> {
  const previous = creates.get(gameId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  creates.set(gameId, current);
  try {
    return await current;
  } finally {
    if (creates.get(gameId) === current) creates.delete(gameId);
  }
}

function imageLimiter(deps: AppDeps) {
  const existing = imageLimiters.get(deps);
  if (existing) return existing;
  const limiter = createRateLimiter(CREATOR_IMAGES_PER_MINUTE, 60_000);
  imageLimiters.set(deps, limiter);
  return limiter;
}

const routes = new Hono<ApiBindings>()
  .post('/:gameId/scope/sessions', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const { choices } = await parseBody(c, createBody);
    const deps = c.get('deps');
    const gameId = c.req.param('gameId');

    const result = await serialized(gameId, async () => {
      const active = scopeSessions.findActive(deps.db, gameId);
      if (active !== null) {
        requireOwner(deps, active, principal);
        return { session: active, created: false };
      }

      const sessionId = `s_${randomUUID()}`;
      const accepted = await admit(
        { db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults: defaults(deps) },
        {
          gameId,
          branchId: 'main',
          kind: 'scope',
          complexity: 1,
          plan: {
            title: `${choices.vibe} ${choices.genre} scope`.slice(0, 120),
            summary: `Agree the scope for a ${choices.vibe} ${choices.genre} in ${choices.world}.`,
            scope: { included: [], excluded: [] },
            tickets: [
              {
                key: 'scope',
                skills: ['gm-scope-options', 'gm-new-game-design'],
                dependsOn: [],
                acceptanceCriteria: [
                  `.gm/scope/${sessionId}.json written with gm scope done and committed in this pull request`,
                  'docs/<slug>/decisions.json and decisions.md committed, schema-valid, with at least 15 product decisions across five areas',
                  'five to eight open, media-backed product decisions raised as creator Commands before this scope ticket is finished',
                ],
              },
            ],
          },
          start: 'now',
          idempotencyKey: `scope:${sessionId}`,
        },
        actorFromPrincipal(principal),
      );
      return {
        session: scopeSessions.create(deps.db, {
          id: sessionId,
          gameId,
          creatorId: principal.userId,
          jobId: accepted.jobId,
          choices,
          at: new Date().toISOString(),
        }),
        created: true,
      };
    }).catch((error: unknown) => {
      if (error instanceof AdmissionRefused) return { refusal: error.body } as const;
      throw error;
    });
    if ('refusal' in result) return c.json(result.refusal, 402);
    return c.json({ sessionId: result.session.id, jobId: result.session.job_id }, result.created ? 201 : 200);
  })
  .get('/:gameId/scope/sessions/:id', (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const session = scopeSessions.get(deps.db, c.req.param('id'));
    if (session === null || session.game_id !== c.req.param('gameId'))
      throw new HttpError(404, 'scope_session_not_found');
    requireOwner(deps, session, principal);
    return c.json(response(session));
  })
  .post('/:gameId/scope/sessions/:id/revisions', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const { expectedRevision } = await parseBody(c, ScopeRevisionRequest);
    const deps = c.get('deps');
    const session = scopeSessions.get(deps.db, c.req.param('id'));
    if (session === null || session.game_id !== c.req.param('gameId'))
      throw new HttpError(404, 'scope_session_not_found');
    requireOwner(deps, session, principal);
    if (expectedRevision < session.revision) throw new HttpError(409, 'scope_revision_stale');
    if (expectedRevision > session.revision) throw new HttpError(409, 'scope_revision_mismatch');
    if (session.status !== 'agreed' && session.status !== 'revising')
      throw new HttpError(409, 'scope_session_not_agreed');

    const revising = scopeSessions.beginRevision(deps.db, session.id, expectedRevision);
    if (revising === null) throw new HttpError(409, 'scope_revision_conflict');
    return c.json(response(revising));
  })
  .post('/:gameId/scope/sessions/:id/images', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const session = scopeSessions.get(deps.db, c.req.param('id'));
    if (session === null || session.game_id !== c.req.param('gameId'))
      throw new HttpError(404, 'scope_session_not_found');
    requireOwner(deps, session, principal);
    if (session.status !== 'open' && session.status !== 'revising') {
      throw new HttpError(409, 'scope_session_not_open');
    }
    if (!imageLimiter(deps)(`${principal.userId}:${session.id}`)) throw new HttpError(429, 'rate_limited');

    const contentType = (c.req.header('content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase();
    if (!contentType.startsWith('image/')) throw new HttpError(415, 'unsupported_image_type');
    const length = c.req.header('content-length');
    if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > MAX_CREATOR_IMAGE_BYTES)) {
      throw new HttpError(413, 'image_too_large');
    }
    const bytes = await readBoundedBody(c.req.raw, MAX_CREATOR_IMAGE_BYTES, 'image_too_large');
    if (bytes.byteLength === 0) throw new HttpError(400, 'empty_image');

    const media = await putCreatorImage(deps.blobStore, bytes).catch((error: unknown) => {
      if (error instanceof MediaError) throw new HttpError(422, 'invalid_image');
      throw error;
    });
    const current = scopeSessions.get(deps.db, session.id);
    if (current?.status !== 'open' && current?.status !== 'revising') {
      throw new HttpError(409, 'scope_session_not_open');
    }
    const runtime = getChatRuntime(deps);
    const { row } = insertChatRow(deps.sqlite, {
      jobId: session.job_id,
      actor: 'creator',
      kind: 'image',
      media,
      mirrorState: 'pending',
    });
    runtime.hub.publish(session.job_id);
    void runtime.mirror.mirror(row!.id).catch((error: unknown) => {
      deps.log({ event: 'chat-mirror-error', jobId: session.job_id, error: (error as Error).name });
    });
    return c.json({ imageId: row!.id }, 201);
  })
  .post('/:gameId/scope/sessions/:id/abandon', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const session = scopeSessions.get(deps.db, c.req.param('id'));
    if (session === null || session.game_id !== c.req.param('gameId'))
      throw new HttpError(404, 'scope_session_not_found');
    requireOwner(deps, session, principal);
    if (session.status !== 'open' && session.status !== 'revising') throw new HttpError(409, 'scope_session_not_open');

    const abandoned = scopeSessions.abandon(deps.db, session.id);
    if (abandoned === null) throw new HttpError(409, 'scope_session_not_open');
    const job = findJobRow(deps.db, session.job_id);
    if (!['done', 'failed', 'cancelled'].includes(job.state)) {
      markTerminal(
        { db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults: defaults(deps) },
        job.id,
        'cancelled',
      );
      if (job.aiurRepo !== null && job.aiurIssueNumber !== null) {
        try {
          const aiur = await deps.aiurClientForGame(job.gameId);
          await aiur.cancel(String(job.aiurIssueNumber));
        } catch (error) {
          deps.log({
            event: 'scope-cancel-upstream-failed',
            jobId: job.id,
            error: error instanceof Error ? error.name : 'unknown',
          });
        }
      }
    }
    return c.json(response(abandoned));
  });

export default routes;
