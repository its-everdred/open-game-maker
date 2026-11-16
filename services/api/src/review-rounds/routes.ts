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
import { bindReviewEpisode, markReviewAnswered, readReviewEpisode } from './answer-guard.js';

export const prefix = '/api/v1';
const Answer = z
  .object({ verdict: z.enum(['approved', 'needs_work']), note: z.string().max(3900).optional() })
  .strict();

type Media = { kind: string; ref: string };
export default new Hono<ApiBindings>()
  .get('/games/:gameId/review-rounds', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const deps = c.get('deps');
    const includeGameplay = c.req.query('includeGameplay') === '1';
    const rounds = deps.db
      .select()
      .from(schema.reviewRounds)
      .where(
        and(
          eq(schema.reviewRounds.gameId, game.id),
          isNull(schema.reviewRounds.verdict),
          includeGameplay ? undefined : ne(schema.reviewRounds.category, 'gameplay'),
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
          ...(includeGameplay ? { buildId: media.find((item) => item.kind === 'build')?.ref ?? null } : {}),
          question: round.question,
          media: items,
          postedAt: round.postedAt,
        };
      }),
    );
    return c.json({ rounds: result });
  })
  .post('/games/:gameId/review-rounds/:id/missing-media', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    if (requirePrincipal(c, ['user']).userId !== game.ownerId) throw new HttpError(403, 'forbidden');
    const deps = c.get('deps');
    const round = getRound(deps.db, game.id, c.req.param('id'));
    if (!round || round.verdict !== null) throw new HttpError(404, 'review_round_not_found');
    const media = JSON.parse(round.media) as Media[];
    if (
      media.some(
        (item) =>
          (['still', 'clip'].includes(item.kind) && /^sha256:[0-9a-f]{64}$/u.test(item.ref)) ||
          (item.kind === 'build' && item.ref !== ''),
      )
    )
      throw new HttpError(409, 'media_present');
    const client = await deps.aiurClientForGame(game.id);
    const receipt = await client.message(
      round.ticket,
      'This creator review is missing media. Please add the media and resend it.',
      `review-media:${round.id}`,
      AbortSignal.timeout(15000),
    );
    if (receipt.warning) throw new HttpError(502, 'message_unconfirmed');
    return c.json({ status: 'asked' });
  })
  .post('/games/:gameId/review-rounds/:id/answer', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    if (requirePrincipal(c, ['user']).userId !== game.ownerId) throw new HttpError(403, 'forbidden');
    const answer = await parseBody(c, Answer);
    const deps = c.get('deps');
    const round = getRound(deps.db, game.id, c.req.param('id'));
    if (!round || round.category === 'gameplay') throw new HttpError(404, 'review_round_not_found');
    let guard: string | undefined;
    const ok = deps.db.transaction((tx) => {
      const answered = answerRound(tx, game.id, round.id, {
        verdict: answer.verdict,
        notes: answer.note ?? null,
        source: 'command',
        at: new Date().toISOString(),
      });
      if (answered) guard = markReviewAnswered(tx, game.id, round.ticket);
      return answered;
    });
    if (!ok) throw new HttpError(409, 'review_round_answered');
    const episode = await readReviewEpisode(
      deps.registry.reviewEpisode,
      game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined,
      round.ticket,
      ['agent:human-review', ...(game.slug ? [`${game.slug}:human-review`] : [])],
    );
    if (guard) bindReviewEpisode(deps.db, game.id, round.ticket, guard, episode);
    return c.json({ status: 'answered' });
  });
