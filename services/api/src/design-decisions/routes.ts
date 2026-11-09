import { Hono, type Context } from 'hono';

import type { DesignDecisionSummariesPage, DesignDecisionsPage } from '@ogm/contracts';

import { bearerToken, hasInternalCredential } from '../app/internal-auth.js';
import { HttpError } from '../app/errors.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { answerCommand } from '../job-commands/answer.js';
import { authorizedGame } from '../games/authorize.js';
import { contextTokenSecret, verifyContextToken } from '../new-game/token.js';
import { createDesignDefaultSweep, designDefaultInterval } from './defaults.js';
import { listDesignDecisions } from './store.js';

// Two surfaces in one module: the private history under `/internal` and the player's summary under `/api/v1`, so the
// prefix stays `/` and each route carries its full path.
export const prefix = '/';

const sweeps = new WeakMap<AppDeps, ReturnType<typeof createDesignDefaultSweep>>();

// One sweep per app, so a test or a restart cannot leave two timers answering the same Command.
export function designDefaultSweep(deps: AppDeps): ReturnType<typeof createDesignDefaultSweep> {
  const existing = sweeps.get(deps);
  if (existing) return existing;
  const created = createDesignDefaultSweep({
    sqlite: deps.sqlite,
    jobs: () => deps.registry.chatJobs,
    defaultMs: deps.config.designDefaultMs,
    intervalMs: designDefaultInterval(deps.config.designDefaultMs),
    answer: async ({ job, row, optionId }) => {
      const outcome = await answerCommand({ deps, job, row, optionId, source: 'default' });
      return outcome.kind === 'answered' ? { answered: true } : { answered: false, reason: outcome.kind };
    },
    log: deps.log,
  });
  sweeps.set(deps, created);
  return created;
}

export function setup(deps: AppDeps): void {
  // The sweep is a background aiur loop like the Command poller: an instance that does not poll aiur does not default
  // Commands either. Tests drive `designDefaultSweep(deps).tick()` directly.
  if (deps.config.commandPollMs === undefined) return;
  designDefaultSweep(deps).start();
}

// The history's game, for the credentials a design-side agent may carry. The shared internal secret — the Executor's
// unit — reads any game. A design agent's `ngc1` request token reads the game its request belongs to and no other: the
// token already grants that request's private context, and its decisions are part of the same conversation. A user
// session and an anonymous caller read neither.
function authorizedHistoryGame(c: Context<ApiBindings>): string {
  const gameId = c.req.param('gameId');
  if (!gameId) throw new HttpError(400, 'invalid_request');
  if (hasInternalCredential(c)) return gameId;
  const token = bearerToken(c);
  const claims =
    token === null ? null : verifyContextToken(token, contextTokenSecret(c.get('deps').config.jobTokenSecret));
  if (claims === null) throw new HttpError(401, 'internal_credential_required');
  if (claims.game !== gameId) throw new HttpError(403, 'forbidden');
  return gameId;
}

// The decision history, oldest first. The Executor and the game's design agent read the whole record — the question,
// every option, the answer that stands and what it superseded — to re-plan with gm-new-game-plan. The route is private:
// the shared internal secret or a scoped request token for this game, never a player's session.
export default new Hono<ApiBindings>()
  .get('/internal/games/:gameId/design-decisions', async (c) => {
    const deps = c.get('deps');
    const page: DesignDecisionsPage = { decisions: listDesignDecisions(deps.db, authorizedHistoryGame(c)) };
    return c.json(page);
  })
  // What the player reads: the question and the answer that now stands, without the option list the design agent and
  // the Executor need. A signed-in member who may play the game reads it; the choices are not private to the owner.
  .get('/api/v1/games/:gameId/design-decisions', async (c) => {
    const game = authorizedGame(c, 'game.play');
    const deps = c.get('deps');
    const decisions = listDesignDecisions(deps.db, game.id);
    const page: DesignDecisionSummariesPage = {
      decisions: decisions.map((decision) => ({
        id: decision.id,
        question: decision.question,
        chosen: decision.chosen,
        chosen_label: decision.options.find(({ id }) => id === decision.chosen)?.label ?? decision.chosen,
        origin: decision.origin,
        skipped: decision.skipped,
        supersedes: decision.supersedes,
        at: decision.at,
      })),
    };
    return c.json(page);
  });
