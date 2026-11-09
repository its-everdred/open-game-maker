import { createHash, timingSafeEqual } from 'node:crypto';

import type { Context } from 'hono';
import { Hono } from 'hono';

import {
  InstructRequest,
  VoiceCommandAnswerRequest,
  VoiceTokenRequest,
  VoiceTranscriptRequest,
  type VoiceTokenResponse,
} from '@ogm/contracts';
import { authorize } from '@ogm/policy';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import type { AppDeps } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { createRateLimiter } from '../auth/rate-limit.js';
import { requireMeteredDispatch } from '../gameplay/policy.js';
import { findGameForFamily } from '../games/games.js';
import { findJobRow } from '../jobs/repo.js';
import { registerVoiceTarget } from './briefing-push.js';
import { answerVoiceCommand } from './command-answer.js';
import { deliverInstruction } from './instruct.js';
import { mintVoiceToken, VOICE_DICTATION_TOKEN_SCOPE } from './token.js';
import { appendVoiceTranscript } from './transcript.js';

export const prefix = '/';

const DICTATION_TOKENS_PER_MINUTE = 10;
const dictationLimiters = new WeakMap<AppDeps, ReturnType<typeof createRateLimiter>>();

export function setup(deps: AppDeps): void {
  dictationLimiters.set(deps, createRateLimiter(DICTATION_TOKENS_PER_MINUTE, 60_000));
}

function dictationLimiter(c: Context<ApiBindings>): ReturnType<typeof createRateLimiter> {
  const limiter = dictationLimiters.get(c.get('deps'));
  if (!limiter) throw new Error('voice context used before setup');
  return limiter;
}

function internalSecret(given: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  const actualHash = createHash('sha256')
    .update(given ?? '')
    .digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

async function authorizedTarget(c: Context<ApiBindings>) {
  const principal = requirePrincipal(c, ['user']);
  requireMeteredDispatch(c);
  const { target } = await parseBody(c, VoiceTokenRequest);
  const { db } = c.get('deps');
  if (target.creator_id !== principal.userId) throw new HttpError(403, 'not_target_creator');
  const game = findGameForFamily(db, target.game_id, principal.familyId);
  requireAuthorization(
    authorize(actorFromPrincipal(principal), 'game.edit', { familyId: game.familyId, ownerId: game.ownerId }),
  );

  if (target.kind === 'build') {
    const job = findJobRow(db, target.job_id);
    if (
      job.gameId !== game.id ||
      job.creatorId !== principal.userId ||
      job.aiurIssueNumber === null ||
      String(job.aiurIssueNumber) !== target.ticket
    ) {
      throw new HttpError(403, 'job_not_in_game');
    }
  } else if (target.kind === 'scope') {
    const session = db.select().from(schema.scopeSessions).where(eq(schema.scopeSessions.id, target.session_id)).get();
    if (!session || session.gameId !== game.id || session.creatorId !== principal.userId) {
      throw new HttpError(403, 'scope_not_in_game');
    }
  }

  return { principal, target };
}

function tokenResponse(deps: AppDeps, sub: string, target: VoiceTokenRequest['target'], scope?: string) {
  const { config } = deps;
  if (!config.voiceTokenSecret || !config.voiceWsUrl) throw new HttpError(503, 'voice_unavailable');

  const { token, exp } = mintVoiceToken({ secret: config.voiceTokenSecret, sub, target, scope });
  registerVoiceTarget(target);
  return {
    token,
    expires_at: new Date(exp * 1000).toISOString(),
    url: config.voiceWsUrl,
  } satisfies VoiceTokenResponse;
}

// POST /api/v1/voice/token: a short-lived token for the voice host, only for a target the caller may edit.
const routes = new Hono<ApiBindings>().post('/api/v1/voice/token', async (c) => {
  const { principal, target } = await authorizedTarget(c);
  const body = tokenResponse(c.get('deps'), principal.userId, target);
  return c.json(body);
});

routes.post('/api/v1/voice/dictation-token', async (c) => {
  const { principal, target } = await authorizedTarget(c);
  if (!dictationLimiter(c)(principal.userId)) throw new HttpError(429, 'rate_limited');
  const body = tokenResponse(c.get('deps'), principal.userId, target, VOICE_DICTATION_TOKEN_SCOPE);
  const url = new URL(body.url);
  url.searchParams.set('mode', 'dictate');
  return c.json({ ...body, url: url.toString() });
});

routes.post('/internal/voice/instruct', async (c) => {
  const deps = c.get('deps');
  if (!internalSecret(c.req.header('x-ogm-internal'), deps.config.voiceInternalSecret)) {
    throw new HttpError(401, 'unauthorized');
  }
  const request = await parseBody(c, InstructRequest);
  const response = await deliverInstruction(deps, request);
  return response.status === 'failed' ? c.json(response, 500) : c.json(response);
});

routes.post('/internal/voice/transcript', async (c) => {
  const deps = c.get('deps');
  if (!internalSecret(c.req.header('x-ogm-internal'), deps.config.voiceInternalSecret)) {
    throw new HttpError(401, 'unauthorized');
  }
  const request = await parseBody(c, VoiceTranscriptRequest);
  const response = appendVoiceTranscript(deps, request);
  if (response === null) throw new HttpError(404, 'voice_target_not_found');
  return c.json(response);
});

routes.post('/internal/voice/command-answer', async (c) => {
  const deps = c.get('deps');
  if (!internalSecret(c.req.header('x-ogm-internal'), deps.config.voiceInternalSecret)) {
    throw new HttpError(401, 'unauthorized');
  }
  const request = await parseBody(c, VoiceCommandAnswerRequest);
  const response = await answerVoiceCommand(deps, request);
  if (response.status === 'stale') return c.json(response, 409);
  if (response.status === 'failed') return c.json(response, 500);
  return c.json(response);
});

export default routes;
