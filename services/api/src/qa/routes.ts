import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { HttpError } from '../app/errors.js';
import { hasInternalCredential } from '../app/internal-auth.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { parseEmailList } from '../auth/access.js';
import { authContextFor } from '../auth/routes.js';
import { ensureQaAccount, mintQaSession } from './account.js';
import { deleteTicketFixtures, seedTicketFixtures } from './tickets.js';
import { deleteReviewFixtures, reviewFixtureReport, seedReviewFixtures } from './fixtures.js';
import { deleteVoiceFixtures, seedVoiceFixture, voiceFixtureReport } from './voice.js';
import { deleteQaNewGame, listNewQaGames, newGameQaReport } from './unprovisioned-games.js';

// The host's QA routes (#859): the QA creator account and its session (`ops/bin/ogm-qa-session`), and the fixtures a
// prod review and voice E2Es (`gm qa review-e2e`, `gm qa voice-e2e`) seed, read back and delete on the QA game. Only the internal token reaches
// them; a user session never does.
export const prefix = '/internal/qa';

const RUN = /^[a-z0-9-]{1,40}$/u;
const SessionBody = z.object({ email: z.string().email() }).strict();
const Base64 = z.string().min(1).max(4_000_000);
const RunBody = z.object({ run: z.string().regex(RUN) }).strict();
const FenceBody = z.object({ owner: z.string().regex(RUN) }).strict();
const DeleteNewGameBody = z
  .object({
    folder: z.string().regex(/^games\/[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    jobs: z.array(z.string().min(1)).max(100),
    repo: z.string().regex(/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u),
    tickets: z
      .array(
        z
          .object({
            jobId: z.string().min(1),
            key: z.string().min(1),
            repo: z.string().min(1),
            issue: z.number().int().positive(),
          })
          .strict(),
      )
      .max(100),
    sessions: z.array(z.object({ id: z.string().min(1), jobId: z.string().min(1) }).strict()).max(100),
    remoteClean: z.literal(true),
    daemonStopped: z.literal(true),
    fenceOwner: z.string().regex(RUN),
  })
  .strict()
  .refine((body) => new Set(body.jobs).size === body.jobs.length);
const FixturesBody = z
  .object({ run: z.string().regex(RUN), media: z.object({ still: Base64, clip: Base64, audio: Base64 }).strict() })
  .strict();

function requireOperator(c: Context<ApiBindings>): void {
  if (!hasInternalCredential(c)) throw new HttpError(401, 'unauthenticated');
}

function run(c: Context<ApiBindings>): string {
  const value = c.req.param('run') ?? '';
  if (!RUN.test(value)) throw new HttpError(400, 'qa_run_invalid');
  return value;
}

async function commitQa(
  deps: AppDeps,
  method: 'GET' | 'POST' | 'DELETE',
  action: 'create-fence' | 'create-audit',
  id: string,
  owner?: string,
) {
  if (!/^g_[A-Za-z0-9_-]{1,126}$/u.test(id)) throw new HttpError(400, 'qa_game_invalid');
  const response = await fetch(
    `${deps.config.commitInternalUrl.replace(/\/$/u, '')}/internal/qa/${action}/${encodeURIComponent(id)}`,
    {
      method,
      headers: { authorization: `Bearer ${deps.config.commitServiceToken}`, 'content-type': 'application/json' },
      ...(owner ? { body: JSON.stringify({ owner }) } : {}),
      signal: AbortSignal.timeout(30_000),
    },
  ).catch(() => null);
  if (!response?.ok) throw new HttpError(409, 'qa_commit_service_unavailable');
  const value = (await response.json().catch(() => null)) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new HttpError(502, 'qa_commit_response_invalid');
  return value as { ready?: unknown; released?: unknown; terminal?: unknown };
}

export default new Hono<ApiBindings>()
  .post('/create-fence/:id', async (c) => {
    requireOperator(c);
    const body = await parseBody(c, FenceBody);
    const id = c.req.param('id');
    if (!/^g_qa-fence-probe-[a-z0-9-]{1,40}$/u.test(id)) newGameQaReport(c.get('deps').db, id);
    const result = await commitQa(c.get('deps'), 'POST', 'create-fence', id, body.owner);
    if (typeof result.ready !== 'boolean') throw new HttpError(502, 'qa_commit_response_invalid');
    return c.json({ ready: result.ready });
  })
  .delete('/create-fence/:id', async (c) => {
    requireOperator(c);
    const body = await parseBody(c, FenceBody);
    const result = await commitQa(c.get('deps'), 'DELETE', 'create-fence', c.req.param('id'), body.owner);
    if (result.released !== true) throw new HttpError(502, 'qa_commit_response_invalid');
    return c.json({ released: true });
  })
  .get('/create-audit/:id', async (c) => {
    requireOperator(c);
    newGameQaReport(c.get('deps').db, c.req.param('id'));
    const result = await commitQa(c.get('deps'), 'GET', 'create-audit', c.req.param('id'));
    if (typeof result.terminal !== 'boolean') throw new HttpError(502, 'qa_commit_response_invalid');
    return c.json({ terminal: result.terminal });
  })
  .get('/new-games', (c) => {
    requireOperator(c);
    c.header('cache-control', 'no-store');
    const deps = c.get('deps');
    return c.json({
      games: listNewQaGames(deps.db),
      instanceRepo: `${deps.config.instanceRepo.owner}/${deps.config.instanceRepo.name}`,
      repo: deps.config.qaInstanceRepo
        ? `${deps.config.qaInstanceRepo.owner}/${deps.config.qaInstanceRepo.name}`
        : null,
    });
  })
  .get('/new-games/:id', (c) => {
    requireOperator(c);
    c.header('cache-control', 'no-store');
    return c.json(newGameQaReport(c.get('deps').db, c.req.param('id')));
  })
  .delete('/new-games/:id', async (c) => {
    requireOperator(c);
    const body = await parseBody(c, DeleteNewGameBody);
    const deps = c.get('deps');
    newGameQaReport(deps.db, c.req.param('id'));
    const fence = await commitQa(deps, 'POST', 'create-fence', c.req.param('id'), body.fenceOwner);
    if (fence.ready !== true) throw new HttpError(409, 'qa_create_fence_not_ready');
    deleteQaNewGame(
      deps.db,
      c.req.param('id'),
      body,
      `${deps.config.instanceRepo.owner}/${deps.config.instanceRepo.name}`,
    );
    return c.json({ status: 'deleted' });
  })
  .post('/session', async (c) => {
    requireOperator(c);
    const body = await parseBody(c, SessionBody);
    const deps = c.get('deps');
    const auth = authContextFor(deps);
    if (!auth) throw new HttpError(503, 'auth_unavailable');
    const state = await ensureQaAccount(deps.db, auth.auth, {
      email: body.email,
      maintainers: parseEmailList(auth.env.OGM_MAINTAINER_EMAILS),
    });
    const session = await mintQaSession(auth.auth, state.userId);
    c.header('cache-control', 'no-store');
    return c.json({ userId: state.userId, email: state.email, gameId: state.gameId, ...session });
  })
  .post('/review-fixtures', bodyLimit({ maxSize: 12_000_000 }), async (c) => {
    requireOperator(c);
    const body = await parseBody(c, FixturesBody);
    const bytes = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));
    const seeded = await seedReviewFixtures(c.get('deps'), body.run, {
      still: bytes(body.media.still),
      clip: bytes(body.media.clip),
      audio: bytes(body.media.audio),
    });
    return c.json(seeded, 201);
  })
  .get('/review-fixtures/:run', (c) => {
    requireOperator(c);
    return c.json(reviewFixtureReport(c.get('deps'), run(c)));
  })
  .delete('/review-fixtures', (c) => {
    requireOperator(c);
    deleteReviewFixtures(c.get('deps'));
    return c.json({ status: 'deleted' });
  })
  .delete('/review-fixtures/:run', (c) => {
    requireOperator(c);
    deleteReviewFixtures(c.get('deps'), run(c));
    return c.json({ status: 'deleted' });
  })
  .post('/ticket-fixtures', bodyLimit({ maxSize: 12_000_000 }), async (c) => {
    requireOperator(c);
    const body = await parseBody(c, FixturesBody);
    const bytes = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));
    const seeded = await seedTicketFixtures(c.get('deps'), body.run, {
      still: bytes(body.media.still),
      clip: bytes(body.media.clip),
      audio: bytes(body.media.audio),
    });
    return c.json(seeded, 201);
  })
  .delete('/ticket-fixtures', (c) => {
    requireOperator(c);
    deleteTicketFixtures(c.get('deps'));
    return c.json({ status: 'deleted' });
  })
  .delete('/ticket-fixtures/:run', (c) => {
    requireOperator(c);
    deleteTicketFixtures(c.get('deps'), run(c));
    return c.json({ status: 'deleted' });
  })
  // The voice E2E's build chat (#879): seeded, read back for the stored transcript, deleted.
  .post('/voice-fixtures', async (c) => {
    requireOperator(c);
    const body = await parseBody(c, RunBody);
    return c.json(seedVoiceFixture(c.get('deps'), body.run), 201);
  })
  .get('/voice-fixtures/:run', (c) => {
    requireOperator(c);
    return c.json(voiceFixtureReport(c.get('deps'), run(c)));
  })
  .delete('/voice-fixtures', (c) => {
    requireOperator(c);
    deleteVoiceFixtures(c.get('deps'));
    return c.json({ status: 'deleted' });
  })
  .delete('/voice-fixtures/:run', (c) => {
    requireOperator(c);
    deleteVoiceFixtures(c.get('deps'), run(c));
    return c.json({ status: 'deleted' });
  });
