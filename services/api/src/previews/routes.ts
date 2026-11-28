import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { HttpError } from '../app/errors.js';
import { parseBody } from '../app/validate.js';
import type { ApiBindings } from '../app/types.js';
import { authorizedGame } from '../games/authorize.js';
import { requirePrincipal } from '../app/principal.js';
import { issueLiveAccess } from './live.js';
import { bindPreview, hasCreatorMembership } from '../artifacts/grants.js';
import { latestRoundForTicket, roundForBuild } from '../review-rounds/store.js';
import {
  beginReviewAnswer,
  bindReviewEpisode,
  discardReviewAnswer,
  readReviewEpisode,
} from '../review-rounds/answer-guard.js';
import {
  answerPreview,
  currentPreview,
  listEditorPreviews,
  listPreviewHistory,
  listPreviews,
  previewDirectory,
} from './store.js';

export const prefix = '/api/v1';

const Verdict = z
  .object({
    buildId: z.string().regex(/^preview-[0-9a-f-]{36}$/u),
    verdict: z.enum(['looks right', 'needs work']),
    note: z.string().max(3900).optional(),
  })
  .strict();

function bindPreviews<T extends { accessId: string }>(
  c: Context<ApiBindings>,
  game: { id: string; ownerId: string; familyId: string },
  previews: T[],
): T[] {
  c.header('Cache-Control', 'no-store');
  const principal = requirePrincipal(c, ['user']);
  if (
    principal.userId !== game.ownerId ||
    principal.capability !== 'creator' ||
    !hasCreatorMembership(c.get('deps'), game.familyId, principal.userId)
  )
    return [];
  return previews.map((preview) => ({
    ...preview,
    accessId: bindPreview(c.get('deps'), game.id, preview.accessId, principal.userId, c.req.raw.headers),
  }));
}

export default new Hono<ApiBindings>()
  .get('/games/:gameId/live/:ticket', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    c.header('Cache-Control', 'no-store');
    const principal = requirePrincipal(c, ['user']);
    if (
      principal.userId !== game.ownerId ||
      principal.capability !== 'creator' ||
      !hasCreatorMembership(c.get('deps'), game.familyId, principal.userId)
    )
      throw new HttpError(404, 'live_preview_not_found');
    const live = await issueLiveAccess(c.get('deps'), game, c.req.param('ticket'));
    const accessId = bindPreview(c.get('deps'), game.id, live.accessId, principal.userId, c.req.raw.headers);
    return c.json({ gameId: game.id, ...live, accessId });
  })
  .get('/games/:gameId/editor/preview-history', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const previews = await listPreviewHistory(c.get('deps'), game.id);
    return c.json({ previews: bindPreviews(c, game, previews) });
  })
  .get('/games/:gameId/editor/previews', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const previews = await listEditorPreviews(c.get('deps'), game.id);
    return c.json({ previews: bindPreviews(c, game, previews) });
  })
  .get('/games/:gameId/previews', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const deps = c.get('deps');
    const previews = (await listPreviews(deps, game.id)).filter((preview) => currentPreview(deps, preview));
    const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
    const named = await Promise.all(
      bindPreviews(c, game, previews).map(async (preview) => {
        const title = await deps.registry.workerTitle?.(preview.ticket, repo).catch(() => '');
        const round = roundForBuild(deps.db, game.id, preview.ticket, preview.buildId);
        return { ...preview, ...(title ? { title } : {}), ...(round?.question ? { question: round.question } : {}) };
      }),
    );
    return c.json({ previews: named });
  })
  .get('/games/:gameId/previews/:ticket/design', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const deps = c.get('deps');
    const preview = (await listEditorPreviews(deps, game.id)).find((item) => item.ticket === c.req.param('ticket'));
    if (!preview || preview.buildId !== c.req.query('buildId')) throw new HttpError(404, 'preview_not_found');
    const doc = JSON.parse(
      await readFile(join(previewDirectory(deps, game.id, preview.buildId), 'design', 'design.json'), 'utf8'),
    ) as unknown;
    return c.json({ rev: 0, doc });
  })
  .post('/games/:gameId/previews/:ticket/answer', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const { buildId, verdict, note } = await parseBody(c, Verdict);
    const ticket = c.req.param('ticket');
    if (!/^[1-9]\d{0,15}$/u.test(ticket)) throw new HttpError(400, 'invalid_ticket');
    const round = roundForBuild(c.get('deps').db, game.id, ticket, buildId);
    if (round && requirePrincipal(c, ['user']).userId !== game.ownerId) throw new HttpError(403, 'forbidden');
    if (round && latestRoundForTicket(c.get('deps').db, game.id, ticket)?.id !== round.id)
      throw new HttpError(409, 'review_round_superseded');
    const message = `Preview review of ${buildId}: ${verdict}.${note ? `\n${note}` : ''}`;
    const deps = c.get('deps');
    const guard = beginReviewAnswer(deps.db, game.id, ticket, `preview:${buildId}`);
    const answered = await answerPreview(c.get('deps'), game.id, ticket, buildId, message, verdict, note);
    if (!answered) {
      const current = [...(await listEditorPreviews(deps, game.id)), ...(await listPreviewHistory(deps, game.id))];
      if (
        guard &&
        !current.some((preview) => preview.ticket === ticket && preview.buildId === buildId && preview.answered)
      )
        discardReviewAnswer(deps.db, game.id, ticket, guard);
      throw new HttpError(409, 'preview_changed');
    }
    const episode = await readReviewEpisode(
      deps.registry.reviewEpisode,
      game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined,
      ticket,
      ['agent:human-review', ...(game.slug ? [`${game.slug}:human-review`] : [])],
    );
    if (guard) bindReviewEpisode(deps.db, game.id, ticket, guard, episode);
    return c.json({ status: 'answered' });
  });
