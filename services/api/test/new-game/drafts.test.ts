import { readFileSync } from 'node:fs';

import type { AgreedScope } from '@ogm/contracts';
import { migrate, openDb, schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { DRAFT_TTL_MS, gameDrafts } from '../../src/new-game/drafts.js';

const at = new Date('2026-11-20T12:00:00.000Z');
const familyId = 'f_87000000-0000-4000-8000-000000000001';
const creatorId = 'u_87000000-0000-4000-8000-000000000001';
const agreedFixture = JSON.parse(
  readFileSync(new URL('../../../../packages/contracts/fixtures/scope/agreed.json', import.meta.url), 'utf8'),
) as AgreedScope;

function setup() {
  const { sqlite, db } = openDb(':memory:');
  migrate({ sqlite });
  db.insert(schema.families)
    .values({ id: familyId, name: 'Family', ownerUserId: creatorId, createdAt: at.toISOString() })
    .run();
  return { sqlite, db };
}

describe('transient game drafts', () => {
  it('stores scope choices separately from games and expires after 24 hours', () => {
    const { db } = setup();
    const draft = gameDrafts.create(db, {
      familyId,
      creatorId,
      choices: {
        genre: 'platformer',
        vibe: 'cozy',
        family: 'chunky-low-poly',
        world: 'island',
        players: 'single',
        pov: 'isometric',
      },
      allowAiGeneratedAssets: false,
      at,
    });

    expect(db.select().from(schema.games).all()).toEqual([]);
    expect(JSON.parse(draft.choices)).toMatchObject({ genre: 'platformer' });
    expect(draft.allowAiGeneratedAssets).toBe(false);
    expect(draft.expiresAt).toBe(new Date(at.getTime() + DRAFT_TTL_MS).toISOString());
    expect(gameDrafts.expired(db, new Date(at.getTime() + DRAFT_TTL_MS - 1))).toEqual([]);
    expect(gameDrafts.expired(db, new Date(at.getTime() + DRAFT_TTL_MS))).toHaveLength(1);
  });

  it('accepts only the next scope revision and promotes only an agreed draft', () => {
    const { db } = setup();
    const draft = gameDrafts.create(db, {
      familyId,
      creatorId,
      choices: {
        genre: 'platformer',
        vibe: 'cozy',
        family: 'chunky-low-poly',
        world: 'island',
        players: 'single',
        pov: 'isometric',
      },
      allowAiGeneratedAssets: true,
      at,
    });
    const scope = { ...agreedFixture, session_id: draft.id };

    const gameId = 'g_87000000-0000-4000-8000-000000000001';
    expect(gameDrafts.promote(db, draft.id, gameId)).toBe(false);
    expect(gameDrafts.agree(db, draft.id, { ...scope, revision: 2 }, at.toISOString())).toBeNull();
    expect(gameDrafts.agree(db, draft.id, scope, at.toISOString())).toMatchObject({
      session_id: draft.id,
      revision: 1,
    });
    db.insert(schema.games)
      .values({
        id: gameId,
        familyId,
        ownerId: creatorId,
        title: 'Game',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: at.toISOString(),
      })
      .run();
    expect(gameDrafts.promote(db, draft.id, gameId, at.toISOString())).toBe(true);
    expect(gameDrafts.get(db, draft.id)).toMatchObject({ status: 'promoted', gameId });
  });
});
