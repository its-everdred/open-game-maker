import { and, eq, isNull, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { BlobHash } from '@ogm/blob-store';
import { schema } from '@ogm/db';
import type { ApiBindings } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import { parseBody } from '../app/validate.js';
import { authorizedGame } from '../games/authorize.js';
import { answerRound, getRound } from './store.js';

export const prefix = '/api/v1';
const Answer = z
  .object({ verdict: z.enum(['approved', 'needs_work']), note: z.string().max(3900).optional() })
  .strict();

type Media = { kind: string; ref: string };
export default new Hono<ApiBindings>()
  .get('/games/:gameId/review-rounds', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const deps = c.get('deps');
    const rounds = deps.db
      .select()
      .from(schema.reviewRounds)
      .where(
        and(
          eq(schema.reviewRounds.gameId, game.id),
          isNull(schema.reviewRounds.verdict),
          ne(schema.reviewRounds.category, 'gameplay'),
        ),
      )
      .all();
    const result = await Promise.all(
      rounds.map(async (round) => {
        const media = JSON.parse(round.media) as Media[];
        const items = await Promise.all(
          media
            .filter(
              (item) => (item.kind === 'still' || item.kind === 'clip') && /^sha256:[0-9a-f]{64}$/u.test(item.ref),
            )
            .map(async (item) => ({
              kind: item.kind,
              url: (await deps.blobStore.signedGet(item.ref as BlobHash, new Date(Date.now() + 3600000))).url,
            })),
        );
        return {
          id: round.id,
          ticket: round.ticket,
          category: round.category,
          question: round.question,
          media: items,
          postedAt: round.postedAt,
        };
      }),
    );
    return c.json({ rounds: result });
  })
  .post('/games/:gameId/review-rounds/:id/answer', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    if (requirePrincipal(c, ['user']).userId !== game.ownerId) throw new HttpError(403, 'forbidden');
    const answer = await parseBody(c, Answer);
    const deps = c.get('deps');
    const round = getRound(deps.db, game.id, c.req.param('id'));
    if (!round || round.category === 'gameplay') throw new HttpError(404, 'review_round_not_found');
    const ok = answerRound(deps.db, game.id, round.id, {
      verdict: answer.verdict,
      notes: answer.note ?? null,
      source: 'command',
      at: new Date().toISOString(),
    });
    if (!ok) throw new HttpError(409, 'review_round_answered');
    return c.json({ status: 'answered' });
  });
