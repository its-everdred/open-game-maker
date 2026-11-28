import { describe, expect, it } from 'vitest';

import { migrate } from '../src/migrate.js';
import { openDb } from '../src/open.js';
import { families, games, invitations } from '../src/schema/index.js';

function migratedDb() {
  const opened = openDb(':memory:');
  migrate({ sqlite: opened.sqlite });
  return opened;
}

describe('accounts schema', () => {
  it('stores a family, game and invitation', () => {
    const { db, sqlite } = migratedDb();
    db.insert(families)
      .values({ id: 'f-1', name: 'Household', ownerUserId: 'u-1', createdAt: '2026-11-01T00:00:00.000Z' })
      .run();
    db.insert(games)
      .values({
        id: 'g-1',
        familyId: 'f-1',
        ownerId: 'u-1',
        title: 'Castle Game',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: '2026-11-01T00:00:00.000Z',
      })
      .run();
    db.insert(invitations)
      .values({
        id: 'i-1',
        familyId: 'f-1',
        kind: 'play',
        email: 'sam@example.com',
        tokenHash: 'a'.repeat(64),
        gameId: 'g-1',
        inviterId: 'u-1',
        expiresAt: '2026-11-04T00:00:00.000Z',
        createdAt: '2026-11-01T00:00:00.000Z',
      })
      .run();

    expect(db.select().from(invitations).get()).toMatchObject({ kind: 'play', gameId: 'g-1' });
    expect(db.select().from(games).get()).toMatchObject({ releaseState: 'released' });
    sqlite.prepare("UPDATE games SET release_state = 'coming_soon' WHERE id = ?").run('g-1');
    expect(db.select().from(games).get()).toMatchObject({ releaseState: 'coming_soon' });
    sqlite.close();
  });

  it('rejects duplicate invitation token hashes', () => {
    const { db, sqlite } = migratedDb();
    db.insert(families)
      .values({ id: 'f-1', name: 'Household', ownerUserId: 'u-1', createdAt: '2026-11-01T00:00:00.000Z' })
      .run();
    const invitation = {
      familyId: 'f-1',
      kind: 'member' as const,
      email: 'sam@example.com',
      tokenHash: 'b'.repeat(64),
      capability: 'creator' as const,
      inviterId: 'u-1',
      expiresAt: '2026-11-04T00:00:00.000Z',
      createdAt: '2026-11-01T00:00:00.000Z',
    };
    db.insert(invitations)
      .values({ id: 'i-1', ...invitation })
      .run();
    expect(() =>
      db
        .insert(invitations)
        .values({ id: 'i-2', ...invitation })
        .run(),
    ).toThrow(/UNIQUE/);
    sqlite.close();
  });

  it('rejects invalid enum values at the SQLite boundary', () => {
    const { sqlite } = migratedDb();
    expect(() =>
      sqlite
        .prepare('INSERT INTO families (id, name, owner_user_id, friends_allowed, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('f-1', 'Household', 'u-1', 2, '2026-11-01T00:00:00.000Z'),
    ).toThrow(/CHECK/);
    sqlite.close();
  });

  it('rejects invitation rows whose target fields do not match the kind', () => {
    const { sqlite } = migratedDb();
    sqlite
      .prepare('INSERT INTO families (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)')
      .run('f-1', 'Household', 'u-1', '2026-11-01T00:00:00.000Z');
    sqlite
      .prepare(
        'INSERT INTO games (id, family_id, owner_id, title, visibility, repo_visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('g-1', 'f-1', 'u-1', 'Game', 'private', 'private', '2026-11-01T00:00:00.000Z');
    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO invitations (id, family_id, kind, email, token_hash, game_id, inviter_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'i-room',
          'f-1',
          'room',
          'sam@example.com',
          'c'.repeat(64),
          'g-1',
          'u-1',
          '2026-11-04T00:00:00.000Z',
          '2026-11-01T00:00:00.000Z',
        ),
    ).toThrow(/CHECK/);
    sqlite.close();
  });
});
