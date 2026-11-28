import type { Context } from 'hono';

import { authorize, type Action } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { findGame, findGameForFamily, findGameForPlay, hasGameGrant, type GameRow } from './games.js';
import { isReviewAdmin } from './review-admin.js';
import { hasCreatorMembership } from '../artifacts/grants.js';

// Review reads are visible across families to platform administrators, without granting game editing access.
export function authorizedReviewGame(c: Context<ApiBindings>): GameRow {
  const principal = requirePrincipal(c, ['user']);
  if (!isReviewAdmin(c.get('deps'), principal)) {
    const game = authorizedGame(c, 'game.edit');
    if (
      principal.capability !== 'creator' ||
      !hasCreatorMembership(c.get('deps'), principal.familyId, principal.userId)
    )
      throw new HttpError(403, 'forbidden');
    return game;
  }
  const gameId = c.req.param('gameId');
  if (!gameId) throw new HttpError(400, 'invalid_request');
  return findGame(c.get('deps').db, gameId);
}

// A review verdict is reserved for the game's current creator, including after a role change.
export function authorizedCreatorReviewGame(c: Context<ApiBindings>): GameRow {
  const principal = requirePrincipal(c, ['user']);
  const game = authorizedGame(c, 'game.edit');
  if (
    principal.userId !== game.ownerId ||
    principal.capability !== 'creator' ||
    !hasCreatorMembership(c.get('deps'), game.familyId, principal.userId)
  )
    throw new HttpError(403, 'forbidden');
  return game;
}

// The game the caller may act on, checked against the caller's family and per-game grants. Every route that names a
// game in its path reads the row through here, so the family and grant rules live in one place.
export function authorizedGame(c: Context<ApiBindings>, action: Action): GameRow {
  const principal = requirePrincipal(c, ['user']);
  const gameId = c.req.param('gameId');
  if (!gameId) throw new HttpError(400, 'invalid_request');
  const game =
    action === 'game.play'
      ? findGameForPlay(c.get('deps').db, gameId, actorFromPrincipal(principal))
      : findGameForFamily(c.get('deps').db, gameId, principal.familyId);
  requireAuthorization(
    authorize(actorFromPrincipal(principal), action, {
      familyId: game.familyId,
      ownerId: game.ownerId,
      visibility: game.visibility,
      releaseState: game.releaseState,
      granted: hasGameGrant(c.get('deps').db, game.id, principal.userId),
    }),
  );
  return game;
}
