import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { BlobHash } from '@ogm/blob-store';
import { schema } from '@ogm/db';
import type { ApiBindings } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import { parseBody } from '../app/validate.js';
import { authorizedGame } from '../games/authorize.js';
import { reviewMediaUrl } from '../blobs/review-url.js';
import { currentPreview, listPreviews } from '../previews/store.js';
import { answerRound, getRound, latestPublishedPrototypeRound, latestRoundForTicket } from './store.js';
import { bindReviewEpisode, markReviewAnswered, readReviewEpisode } from './answer-guard.js';
import { logReviewFeedRefresh } from './feed-log.js';

export const prefix = '/api/v1';
const Answer = z
  .object({ verdict: z.enum(['approved', 'needs_work']), note: z.string().max(3900).optional() })
  .strict();

type Media = { kind: string; ref: string; role?: 'target'; meta?: unknown };
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
          sql`NOT EXISTS (
            SELECT 1 FROM review_rounds AS newer
            WHERE newer.game_id = ${schema.reviewRounds.gameId}
              AND (
                (${schema.reviewRounds.track} = 'prototype-publish' AND newer.track = 'prototype-publish')
                OR (${schema.reviewRounds.track} <> 'prototype-publish' AND newer.track <> 'prototype-publish'
                  AND newer.ticket = ${schema.reviewRounds.ticket})
              )
              AND (julianday(newer.posted_at) > julianday(${schema.reviewRounds.postedAt})
                OR (julianday(newer.posted_at) = julianday(${schema.reviewRounds.postedAt}) AND newer.rowid > review_rounds.rowid))
          )`,
          includeGameplay
            ? undefined
            : or(
                ne(schema.reviewRounds.category, 'gameplay'),
                eq(schema.reviewRounds.track, 'prototype-publish'),
                and(
                  eq(schema.reviewRounds.phase, 'mock'),
                  sql`NOT EXISTS (SELECT 1 FROM json_each(${schema.reviewRounds.media}) WHERE json_extract(value, '$.kind') = 'build')`,
                ),
              ),
        ),
      )
      .all();
    const result = await Promise.all(
      rounds.map(async (round) => {
        const media = JSON.parse(round.media) as Media[];
        const items = await Promise.all(
          media
            .filter(
              (item) =>
                (['still', 'clip'].includes(item.kind) ||
                  (item.kind === 'audio' &&
                    round.audioVerified &&
                    round.category === 'sound' &&
                    round.phase === 'mock')) &&
                /^sha256:[0-9a-f]{64}$/u.test(item.ref),
            )
            .map(async (item) => ({
              kind: item.kind,
              ...(item.role === 'target' ? { role: item.role } : {}),
              ...(item.meta === undefined ? {} : { meta: item.meta }),
              url: await reviewMediaUrl(deps.blobStore, deps.config.appOrigin, item.ref as BlobHash),
            })),
        );
        return {
          id: round.id,
          ticket: round.ticket,
          track: round.track,
          category: round.category,
          ...(includeGameplay ? { buildId: media.find((item) => item.kind === 'build')?.ref ?? null } : {}),
          question: round.question,
          works: JSON.parse(round.works) as string[],
          limitations: JSON.parse(round.limitations) as string[],
          decisionIds: JSON.parse(round.decisionIds) as string[],
          clipStatus: round.clipStatus,
          sourceTickets: JSON.parse(round.sourceTickets) as string[],
          playUrl:
            round.track === 'prototype-publish' && media.find((item) => item.kind === 'build') && game.slug
              ? `${deps.config.gamesOrigin.replace(/\/$/u, '')}/g/${encodeURIComponent(game.id)}/${encodeURIComponent(media.find((item) => item.kind === 'build')!.ref)}/`
              : null,
          media: items,
          postedAt: round.postedAt,
        };
      }),
    );
    await logReviewFeedRefresh(
      'rounds',
      game.id,
      result.map((round) => ({ ticket: round.ticket, id: round.id, postedAt: round.postedAt })),
      deps.log,
    );
    return c.json({ rounds: result });
  })
  .get('/games/:gameId/review-rounds/:id/status', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    if (requirePrincipal(c, ['user']).userId !== game.ownerId) throw new HttpError(403, 'forbidden');
    const deps = c.get('deps');
    const round = getRound(deps.db, game.id, c.req.param('id'));
    if (!round) throw new HttpError(404, 'review_round_not_found');
    const intent = deps.db
      .select()
      .from(schema.reviewDispatchIntents)
      .where(eq(schema.reviewDispatchIntents.roundId, round.id))
      .get();
    const nextPhase = deps.db
      .select()
      .from(schema.reviewPhaseOwners)
      .where(and(eq(schema.reviewPhaseOwners.gameId, game.id), eq(schema.reviewPhaseOwners.sourceRoundId, round.id)))
      .get();
    const latest =
      round.track === 'prototype-publish'
        ? latestPublishedPrototypeRound(deps.db, game.id)
        : latestRoundForTicket(deps.db, game.id, round.ticket);
    return c.json({
      status: !round.verdict
        ? 'open'
        : intent?.state === 'delivered' || intent?.state === 'consumed'
          ? 'sent'
          : 'pending',
      ...(nextPhase ? { nextPhase: { phase: nextPhase.phase, ticket: nextPhase.ticket } } : {}),
      ...(latest && latest.id !== round.id && latest.verdict === null ? { newRound: true } : {}),
    });
  })
  .post('/games/:gameId/review-rounds/:id/missing-media', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    if (requirePrincipal(c, ['user']).userId !== game.ownerId) throw new HttpError(403, 'forbidden');
    const deps = c.get('deps');
    const round = getRound(deps.db, game.id, c.req.param('id'));
    if (!round || round.verdict !== null) throw new HttpError(404, 'review_round_not_found');
    if (
      (round.track === 'prototype-publish'
        ? latestPublishedPrototypeRound(deps.db, game.id)
        : latestRoundForTicket(deps.db, game.id, round.ticket)
      )?.id !== round.id
    )
      throw new HttpError(409, 'review_round_superseded');
    const media = JSON.parse(round.media) as Media[];
    if (c.req.query('kind') === 'build' && round.track !== 'prototype-publish') {
      const build = media.find((item) => item.kind === 'build' && item.ref !== '');
      if (!build) throw new HttpError(409, 'review_changed');
      const previews = await listPreviews(deps, game.id);
      if (
        previews.some(
          (preview) =>
            preview.ticket === round.ticket && preview.buildId === build.ref && currentPreview(deps, preview),
        )
      )
        throw new HttpError(409, 'media_present');
    } else if (
      media.some(
        (item) =>
          (((['still', 'clip'].includes(item.kind) && item.role !== 'target') ||
            (item.kind === 'audio' && round.audioVerified)) &&
            /^sha256:[0-9a-f]{64}$/u.test(item.ref)) ||
          (item.kind === 'build' && item.ref !== ''),
      )
    )
      throw new HttpError(409, 'media_present');
    const client = await deps.aiurClientForGame(game.id);
    const currentRound = getRound(deps.db, game.id, round.id);
    if (!currentRound || currentRound.verdict !== null) throw new HttpError(404, 'review_round_not_found');
    if (
      (round.track === 'prototype-publish'
        ? latestPublishedPrototypeRound(deps.db, game.id)
        : latestRoundForTicket(deps.db, game.id, round.ticket)
      )?.id !== round.id
    )
      throw new HttpError(409, 'review_round_superseded');
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
    if (
      !round ||
      (round.track !== 'prototype-publish' &&
        round.category === 'gameplay' &&
        (JSON.parse(round.media) as Media[]).some((item) => item.kind === 'build'))
    )
      throw new HttpError(404, 'review_round_not_found');
    let guard: string | undefined;
    const ok = deps.db.transaction((tx) => {
      if (
        (round.track === 'prototype-publish'
          ? latestPublishedPrototypeRound(tx, game.id)
          : latestRoundForTicket(tx, game.id, round.ticket)
        )?.id !== round.id
      )
        throw new HttpError(409, 'review_round_superseded');
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
    const episode =
      round.track === 'prototype-publish'
        ? null
        : await readReviewEpisode(
            deps.registry.reviewEpisode,
            game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined,
            round.ticket,
            ['agent:human-review', ...(game.slug ? [`${game.slug}:human-review`] : [])],
          );
    if (guard) bindReviewEpisode(deps.db, game.id, round.ticket, guard, episode);
    return c.json({ status: 'answered' });
  });
