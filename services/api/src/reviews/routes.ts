import { Hono } from 'hono';

import { ReviewDraftBody, ReviewDraftKey, type CommandReviewsPage, type ReviewDraftsPage } from '@ogm/contracts';

import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import { parseBody } from '../app/validate.js';
import type { ApiBindings } from '../app/types.js';
import { authorizedGame } from '../games/authorize.js';
import { listDrafts, saveDraft } from './drafts.js';
import { listReviews } from './store.js';

export const prefix = '/api/v1';

// The game's review ledger (A3): every review-deck answer the game took, newest first, with each card's label and the
// creator's words on a dislike. A signed-in member who may edit the game reads it; the same rows are what #567 turns
// into the game's design/feedback.json.
export default new Hono<ApiBindings>()
  .get('/games/:gameId/reviews', (c) => {
    const game = authorizedGame(c, 'game.edit');
    const page: CommandReviewsPage = { reviews: listReviews(c.get('deps').db, game.id) };
    return c.json(page);
  })
  // The signed-in creator's review-deck drafts for the game (#631): the votes saved as they were cast.
  .get('/games/:gameId/review-drafts', (c) => {
    const game = authorizedGame(c, 'game.edit');
    const { userId } = requirePrincipal(c, ['user']);
    const page: ReviewDraftsPage = { drafts: listDrafts(c.get('deps').db, game.id, userId) };
    return c.json(page);
  })
  .put('/games/:gameId/review-drafts/:key', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const { userId } = requirePrincipal(c, ['user']);
    const key = ReviewDraftKey.safeParse(c.req.param('key'));
    if (!key.success) throw new HttpError(400, 'invalid_request');
    const { deck } = await parseBody(c, ReviewDraftBody);
    saveDraft(c.get('deps').db, game.id, userId, key.data, deck, new Date().toISOString());
    return c.body(null, 204);
  });
