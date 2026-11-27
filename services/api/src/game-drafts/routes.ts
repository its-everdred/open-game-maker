import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import { z } from 'zod';

import { ScopeChoices } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { eq } from 'drizzle-orm';

import { actorFromPrincipal, createFamily, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { insertChatRow } from '../build-chat/store.js';
import { gameDrafts } from '../new-game/drafts.js';
import { discardGameDraft } from './cleanup.js';

export const prefix = '/api/v1/game-drafts';

const createBody = z.object({ choices: ScopeChoices, allowAiGeneratedAssets: z.boolean().default(true) }).strict();
const attachGameBody = z.object({ gameId: z.string().min(1) }).strict();
type UserPrincipal = Extract<ReturnType<typeof requirePrincipal>, { kind: 'user' }>;

function requireOwner(draft: ReturnType<typeof gameDrafts.get>, principal: UserPrincipal): NonNullable<typeof draft> {
  if (!draft) throw new HttpError(404, 'draft_not_found');
  requireAuthorization(
    authorize(actorFromPrincipal(principal), 'job.create', {
      gameId: draft.id,
      familyId: draft.familyId,
      ownerId: draft.creatorId,
    }),
  );
  return draft;
}

const routes = new Hono<ApiBindings>()
  .post('/', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    requireAuthorization(authorize(actorFromPrincipal(principal), 'game.create', { familyId: principal.familyId }));
    const body = await parseBody(c, createBody);
    const deps = c.get('deps');
    const assistant = deps.registry.draftScopeAssistant;
    if (!assistant) throw new HttpError(503, 'draft_scope_unavailable');
    const familyId = principal.familyId || createFamily(deps.db, { userId: principal.userId, name: 'My games' }).id;
    const draft = gameDrafts.create(deps.db, {
      familyId,
      creatorId: principal.userId,
      choices: body.choices,
      allowAiGeneratedAssets: body.allowAiGeneratedAssets,
    });
    const repo = `${deps.config.instanceRepo.owner}/${deps.config.instanceRepo.name}`;
    gameDrafts.attachTicket(deps.db, draft.id, repo, null);
    try {
      const ticket = await assistant.create({ draftId: draft.id, choices: body.choices });
      gameDrafts.attachTicket(deps.db, draft.id, ticket.repo, Number(ticket.ticket));
      return c.json({ draftId: draft.id, jobId: `draft:${draft.id}`, status: 'open' }, 201);
    } catch (error) {
      let closed = false;
      try {
        await assistant.close({ repo, draftId: draft.id });
        closed = true;
      } catch (closeError) {
        deps.log({ event: 'draft-scope-orphan-close-failed', draftId: draft.id, error: (closeError as Error).name });
      }
      if (closed) gameDrafts.delete(deps.db, draft.id);
      deps.log({ event: 'draft-scope-create-failed', draftId: draft.id, error: (error as Error).name });
      throw new HttpError(503, 'draft_scope_unavailable');
    }
  })
  .get('/:id', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const draft = requireOwner(gameDrafts.get(deps.db, c.req.param('id')), principal);
    if (draft.status === 'open' && draft.ticketNumber !== null) {
      try {
        const transcript = await deps.registry.draftScopeAssistant?.transcript({ ticket: String(draft.ticketNumber) });
        for (const [index, event] of (transcript ?? []).entries()) {
          const id = `m_${createHash('sha256')
            .update(`${draft.id}\0${event.turn_id ?? index}\0${event.body}`)
            .digest('hex')
            .slice(0, 32)}`;
          const displayText = event.body.replace(/```ogm-scope[\s\S]*?```/u, '').trim();
          if (displayText) {
            insertChatRow(deps.sqlite, {
              id,
              jobId: `draft:${draft.id}`,
              actor: 'agent',
              kind: 'text',
              text: displayText,
              aiur: { ticket: String(draft.ticketNumber) },
            });
          }
        }
        for (const event of [...(transcript ?? [])].reverse()) {
          const match = /```ogm-scope\s*([\s\S]*?)```/u.exec(event.body);
          if (!match) continue;
          try {
            gameDrafts.agree(deps.db, draft.id, JSON.parse(match[1]!));
          } catch {
            // A malformed or not-yet-complete scope reply leaves the draft open for another worker turn.
          }
          break;
        }
      } catch (error) {
        deps.log({ event: 'draft-scope-transcript-failed', draftId: draft.id, error: (error as Error).name });
      }
    }
    const latest = gameDrafts.get(deps.db, draft.id)!;
    return c.json({
      sessionId: latest.id,
      status: latest.status,
      revision: latest.revision,
      chatJobId: `draft:${latest.id}`,
      choices: JSON.parse(latest.choices) as unknown,
      ...(latest.scope === null ? {} : { scope: JSON.parse(latest.scope) as unknown }),
    });
  })
  .post('/:id/abandon', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const draft = requireOwner(gameDrafts.get(deps.db, c.req.param('id')), principal);
    if (draft.status === 'promoted') throw new HttpError(409, 'draft_already_promoted');
    if (draft.gameId !== null) throw new HttpError(409, 'draft_already_finished');
    await discardGameDraft(deps, draft);
    return c.body(null, 204);
  })
  .post('/:id/attach-game', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const draft = requireOwner(gameDrafts.get(deps.db, c.req.param('id')), principal);
    const { gameId } = await parseBody(c, attachGameBody);
    const game = deps.db.select().from(schema.games).where(eq(schema.games.id, gameId)).get();
    if (!game || game.familyId !== draft.familyId || game.ownerId !== draft.creatorId) {
      throw new HttpError(404, 'game_not_found');
    }
    if (draft.status !== 'agreed' || !gameDrafts.attachGame(deps.db, draft.id, gameId)) {
      if (draft.gameId !== gameId) throw new HttpError(409, 'draft_not_ready');
    }
    return c.json({ draftId: draft.id, gameId });
  })
  .post('/:id/complete', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const draft = requireOwner(gameDrafts.get(deps.db, c.req.param('id')), principal);
    if (draft.status === 'promoted') return c.body(null, 204);
    if (draft.status !== 'agreed' || draft.gameId === null || !gameDrafts.complete(deps.db, draft.id)) {
      throw new HttpError(409, 'draft_not_ready');
    }
    return c.body(null, 204);
  });

export default routes;
