import { Hono } from 'hono';

import type { CommandReviewsPage } from '@ogm/contracts';

import type { ApiBindings } from '../app/types.js';
import { authorizedGame } from '../games/authorize.js';
import { listReviews } from './store.js';

export const prefix = '/api/v1';

// The game's review ledger (A3): every review-deck answer the game took, newest first, with each card's label and the
// creator's words on a dislike. A signed-in member who may edit the game reads it; the same rows are what #567 turns
// into the game's design/feedback.json.
export default new Hono<ApiBindings>().get('/games/:gameId/reviews', (c) => {
  const game = authorizedGame(c, 'game.edit');
  const page: CommandReviewsPage = { reviews: listReviews(c.get('deps').db, game.id) };
  return c.json(page);
});
