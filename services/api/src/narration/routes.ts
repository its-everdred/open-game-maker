import { Hono } from 'hono';
import { z } from 'zod';

import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { requireMeteredDispatch } from '../gameplay/policy.js';
import { findGame, findGameForFamily } from '../games/games.js';
import { getNarrationRenderer, NarrationLine } from './render.js';

export const prefix = '/api/v1/games';

const renderBody = z.object({ lines: z.array(NarrationLine).min(1).max(25) }).strict();

export default new Hono<ApiBindings>().post('/:gameId/narration/render', async (c) => {
  const principal = requirePrincipal(c, ['user', 'service']);
  const deps = c.get('deps');
  const gameId = c.req.param('gameId');

  if (principal.kind === 'user') {
    const game = findGameForFamily(deps.db, gameId, principal.familyId);
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.edit', { familyId: game.familyId, ownerId: game.ownerId }),
    );
  } else if (principal.service !== 'builder') {
    throw new HttpError(403, 'forbidden');
  } else {
    findGame(deps.db, gameId);
  }

  requireMeteredDispatch(c);
  const renderer = getNarrationRenderer(deps);
  if (!renderer) throw new HttpError(503, 'narration_unavailable');
  const { lines } = await parseBody(c, renderBody);
  return c.json(await renderer.renderLines(lines));
});
