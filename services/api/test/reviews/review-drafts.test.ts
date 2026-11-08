import type { ReviewDraftDeck } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { listDrafts, saveDraft } from '../../src/reviews/drafts.js';
import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';

// #631: a review deck has no Send. Each vote is saved on the server as it is cast, so leaving midway, a reload or
// another device keeps the votes, and the deck answers the Command once every card has one.

const ids = {
  family: 'f_63100000-0000-4000-8000-000000000001',
  owner: 'u_63100000-0000-4000-8000-000000000001',
  other: 'u_63100000-0000-4000-8000-000000000002',
  game: 'g_63100000-0000-4000-8000-000000000001',
};
const AT = '2026-11-08T10:00:00.000Z';
const KEY = 'dec_blobs_voices:1';

async function setup() {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.owner, createdAt: AT })
    .run();
  for (const userId of [ids.owner, ids.other]) {
    deps.db
      .insert(schema.familyMembers)
      .values({
        familyId: ids.family,
        userId,
        role: userId === ids.owner ? 'owner' : 'member',
        capability: 'creator',
        joinedAt: AT,
      })
      .run();
  }
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.owner,
      title: 'Blobs',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: AT,
    })
    .run();
  installUsers(
    deps,
    [ids.owner, ids.other].map((userId, index) => ({
      kind: 'user' as const,
      userId,
      familyId: ids.family,
      platformRole: 'none' as const,
      capability: 'creator' as const,
      email: `creator${index}@example.test`,
    })),
  );
  const { app } = await makeApp(deps);
  const put = (userId: string, deck: unknown, key = KEY) =>
    app.request(`/api/v1/games/${ids.game}/review-drafts/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { ...asUser(userId), 'content-type': 'application/json' },
      body: JSON.stringify({ deck }),
    });
  const list = async (userId: string) => {
    const response = await app.request(`/api/v1/games/${ids.game}/review-drafts`, { headers: asUser(userId) });
    expect(response.status).toBe(200);
    return ((await response.json()) as { drafts: Array<{ key: string; deck: unknown }> }).drafts;
  };
  return { put, list, deps };
}

const oneVote: ReviewDraftDeck = { cards: [{ option_id: 'pip', verdict: 'like' }] };
const twoVotes: ReviewDraftDeck = {
  cards: [
    { option_id: 'pip', verdict: 'like' },
    { option_id: 'mo', verdict: 'dislike', reason: 'Too squeaky' },
  ],
};

describe('review deck drafts', () => {
  it('keeps the latest votes the creator cast for a question', async () => {
    const { put, list } = await setup();

    expect((await put(ids.owner, oneVote)).status).toBe(204);
    expect((await put(ids.owner, twoVotes)).status).toBe(204);

    expect(await list(ids.owner)).toEqual([{ key: KEY, deck: twoVotes, updated_at: expect.any(String) }]);
  });

  it('keeps each creator’s votes their own', async () => {
    const { deps } = await setup();

    saveDraft(deps.db, ids.game, ids.owner, KEY, twoVotes, AT);

    expect(listDrafts(deps.db, ids.game, ids.other)).toEqual([]);
    expect(listDrafts(deps.db, ids.game, ids.owner)).toHaveLength(1);
  });

  it('refuses a creator who may not edit the game', async () => {
    const { put } = await setup();

    expect((await put(ids.other, oneVote)).status).toBe(403);
  });

  it('refuses a deck that is not a deck and saves nothing', async () => {
    const { put, list } = await setup();

    expect((await put(ids.owner, { cards: [{ option_id: 'pip', verdict: 'maybe' }] })).status).toBe(400);
    expect((await put(ids.owner, oneVote, 'not a key')).status).toBe(400);

    expect(await list(ids.owner)).toEqual([]);
  });
});
