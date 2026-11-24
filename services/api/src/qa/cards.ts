import { schema } from '@ogm/db';
import { and, isNull, not, like, or } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import { gameResponse } from '../games/games.js';
import { gameMedia } from '../games/media.js';

/**
 * Every game's card as a creator's games list shows it (#1312): the post-deploy cards check (`gm qa cards-check`) puts
 * these in the QA session's list, so it sees the real games' thumbnails and logos. QA games are left out, as the play
 * check leaves them out.
 */
export async function cardGames(deps: AppDeps) {
  const games = deps.db
    .select()
    .from(schema.games)
    .where(and(isNull(schema.games.delistedAt), or(isNull(schema.games.slug), not(like(schema.games.slug, 'qa-%')))))
    .all();
  const media = await gameMedia(
    deps,
    games.map((game) => game.id),
  );
  return games.map((game) => ({ ...gameResponse(game), ...media.get(game.id) }));
}
