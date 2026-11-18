import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { acquirePlayLease, assertPlayLease, LeaseHeld, LeaseMismatch } from '../src/saves/lease.js';
import {
  StaleRevision,
  countSavesAboveSchema,
  getSaveRevision,
  listSaveSlots,
  putSaveRevision,
} from '../src/saves/store.js';
import { deriveSaveStatus } from '../src/saves/status.js';
import { makeDeps } from './helpers.js';

const ids = {
  family: 'f_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  game: 'g_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  user: 'u_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  other: 'u_01BX5ZZKBKACTAV9WEVGEMMVRZ',
  device: 'device_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  otherDevice: 'device_01BX5ZZKBKACTAV9WEVGEMMVRZ',
  tab: 'tab_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  branch: 'b_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  build: 'build_01ARZ3NDEKTSV4RRFFQ69G5FAV',
} as const;

const now = new Date('2026-11-01T16:00:00.000Z');

function setup() {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.user, createdAt: now.toISOString() })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.user,
      title: 'Save test',
      visibility: 'listed',
      repoVisibility: 'private',
      createdAt: now.toISOString(),
    })
    .run();
  acquirePlayLease(deps.sqlite, { userId: ids.user, gameId: ids.game, deviceId: ids.device, tabId: ids.tab }, { now });
  return deps;
}

function putInput(revision: number, overrides: Record<string, unknown> = {}) {
  return {
    userId: ids.user,
    gameId: ids.game,
    slotId: 'auto' as const,
    ifMatch: revision,
    payload: new TextEncoder().encode(`save-${revision + 1}`),
    branchId: ids.branch,
    buildId: ids.build,
    saveSchemaVersion: 3,
    deviceId: ids.device,
    clientSeq: revision + 1,
    reason: 'interval' as const,
    now: new Date(now.getTime() + revision * 1_000),
    ...overrides,
  };
}

describe('save store', () => {
  it('assigns revisions atomically, reports stale heads, and replays idempotency keys', () => {
    const deps = setup();
    const first = putSaveRevision(deps.sqlite, putInput(0));
    expect(first).toEqual({ revision: 1, replayed: false });
    expect(putSaveRevision(deps.sqlite, putInput(0))).toEqual({ revision: 1, replayed: true });
    expect(() => putSaveRevision(deps.sqlite, putInput(0, { clientSeq: 2 }))).toThrow(
      expect.objectContaining({ name: 'StaleRevision', headRevision: 1 }),
    );
    expect(new StaleRevision(7)).toMatchObject({ headRevision: 7 });
    expect(getSaveRevision(deps.sqlite, ids.user, ids.game, 'auto')).toMatchObject({ revision: 1 });
  });

  it('keeps the newest five revisions plus migration ancestors', () => {
    const deps = setup();
    let head = 0;
    for (let index = 1; index <= 8; index += 1) {
      putSaveRevision(
        deps.sqlite,
        putInput(head, {
          clientSeq: index,
          migratedFromRevision: index === 3 ? 2 : undefined,
        }),
      );
      head = index;
    }

    const rows = deps.sqlite
      .prepare<[], { revision: number }>('SELECT revision FROM save_revisions ORDER BY revision')
      .all();
    expect(rows.map(({ revision }) => revision)).toEqual([2, 4, 5, 6, 7, 8]);
  });

  it('lists heads and counts saves above a schema across users', () => {
    const deps = setup();
    putSaveRevision(deps.sqlite, putInput(0, { saveSchemaVersion: 4 }));
    acquirePlayLease(
      deps.sqlite,
      { userId: ids.other, gameId: ids.game, deviceId: ids.otherDevice, tabId: 'tab-other' },
      { now },
    );
    putSaveRevision(
      deps.sqlite,
      putInput(0, {
        userId: ids.other,
        deviceId: ids.otherDevice,
        slotId: '1',
        saveSchemaVersion: 4,
      }),
    );
    putSaveRevision(deps.sqlite, putInput(1, { clientSeq: 2, saveSchemaVersion: 2 }));

    expect(listSaveSlots(deps.sqlite, ids.user, ids.game)).toMatchObject([
      { slotId: 'auto', headRevision: 2, headSchema: 2, savedAt: '2026-11-01T16:00:01.000Z' },
    ]);
    expect(countSavesAboveSchema(deps.sqlite, ids.game, 3)).toBe(1);
  });

  it('checks the active lease inside the save transaction', () => {
    const deps = setup();
    acquirePlayLease(
      deps.sqlite,
      { userId: ids.user, gameId: ids.game, deviceId: ids.otherDevice, tabId: 'tab-other' },
      { now, takeover: true },
    );

    expect(() => putSaveRevision(deps.sqlite, putInput(0))).toThrow(LeaseMismatch);
    expect(deps.sqlite.prepare('SELECT COUNT(*) AS count FROM save_revisions').get()).toEqual({ count: 0 });
  });
});

describe('play lease and save status', () => {
  it('requires explicit takeover and fences the previous holder', () => {
    const deps = setup();
    acquirePlayLease(
      deps.sqlite,
      { userId: ids.user, gameId: ids.game, deviceId: ids.device, tabId: ids.tab },
      { now },
    );
    expect(() =>
      acquirePlayLease(
        deps.sqlite,
        { userId: ids.user, gameId: ids.game, deviceId: ids.otherDevice, tabId: 'tab-other' },
        { now },
      ),
    ).toThrow(LeaseHeld);
    expect(
      acquirePlayLease(
        deps.sqlite,
        { userId: ids.user, gameId: ids.game, deviceId: ids.otherDevice, tabId: 'tab-other' },
        { now, takeover: true },
      ).previousHolder,
    ).toBe(ids.device);
    expect(() =>
      assertPlayLease(deps.sqlite, {
        userId: ids.user,
        gameId: ids.game,
        deviceId: ids.device,
        tabId: ids.tab,
        now,
      }),
    ).toThrow(LeaseMismatch);
  });

  it('derives all four compatibility outcomes', () => {
    expect(deriveSaveStatus(3, 3, 2)).toBe('ok');
    expect(deriveSaveStatus(2, 3, 2)).toBe('needs_migration');
    expect(deriveSaveStatus(4, 3, 2)).toBe('incompatible_after_rollback');
    expect(deriveSaveStatus(1, 3, 2)).toBe('unsupported_old');
  });
});
