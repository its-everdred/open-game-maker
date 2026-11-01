import { describe, expect, it } from 'vitest';

import { migrate } from '../src/migrate.js';
import { openDb } from '../src/open.js';
import { families, games, roomMembers, rooms } from '../src/schema/index.js';

function migratedDb() {
  const opened = openDb(':memory:');
  migrate({ sqlite: opened.sqlite });
  return opened;
}

function insertGame(db: ReturnType<typeof migratedDb>['db']) {
  db.insert(families)
    .values({ id: 'f-1', name: 'Household', ownerUserId: 'u-owner', createdAt: '2026-11-01T00:00:00.000Z' })
    .run();
  db.insert(games)
    .values({
      id: 'g-1',
      familyId: 'f-1',
      ownerId: 'u-owner',
      title: 'Castle Game',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: '2026-11-01T00:00:00.000Z',
    })
    .run();
}

describe('rooms schema', () => {
  it('stores room lifecycle state and cascades its memberships', () => {
    const { db, sqlite } = migratedDb();
    insertGame(db);

    db.insert(rooms)
      .values({
        id: 'room-1',
        gameId: 'g-1',
        branchId: 'branch-1',
        buildId: 'build-1',
        ownerId: 'u-owner',
        maxPlayers: 4,
        createdAt: '2026-11-01T00:00:00.000Z',
      })
      .run();
    db.insert(roomMembers)
      .values({ roomId: 'room-1', userId: 'u-player', joinedAt: '2026-11-01T00:01:00.000Z' })
      .run();

    db.update(rooms)
      .set({ endedAt: '2026-11-01T00:02:00.000Z', endReason: 'empty' })
      .run();
    expect(db.select().from(rooms).get()).toMatchObject({ endedAt: '2026-11-01T00:02:00.000Z', endReason: 'empty' });

    db.delete(rooms).run();
    expect(db.select().from(roomMembers).all()).toEqual([]);
    sqlite.close();
  });

  it('rejects room sizes outside the supported one-to-eight player range', () => {
    const { db, sqlite } = migratedDb();
    insertGame(db);

    expect(() =>
      db
        .insert(rooms)
        .values({
          id: 'room-too-large',
          gameId: 'g-1',
          branchId: 'branch-1',
          buildId: 'build-1',
          ownerId: 'u-owner',
          maxPlayers: 9,
          createdAt: '2026-11-01T00:00:00.000Z',
        })
        .run(),
    ).toThrow(/CHECK/);
    sqlite.close();
  });
});
