import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { HttpError } from '../app/errors.js';
import { hasInternalCredential } from '../app/internal-auth.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { parseEmailList } from '../auth/access.js';
import { authContextFor } from '../auth/routes.js';
import { ensureQaAccount, mintQaSession } from './account.js';
import { deleteReviewFixtures, reviewFixtureReport, seedReviewFixtures } from './fixtures.js';

// The host's QA routes (#859): the QA creator account and its session (`ops/bin/ogm-qa-session`), and the fixtures a
// prod review E2E (`gm qa review-e2e`) seeds, reads back and deletes on the QA game. Only the internal token reaches
// them; a user session never does.
export const prefix = '/internal/qa';

const RUN = /^[a-z0-9-]{1,40}$/u;
const SessionBody = z.object({ email: z.string().email() }).strict();
const Base64 = z.string().min(1).max(4_000_000);
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

export default new Hono<ApiBindings>()
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
  .delete('/review-fixtures/:run', (c) => {
    requireOperator(c);
    deleteReviewFixtures(c.get('deps'), run(c));
    return c.json({ status: 'deleted' });
  });
