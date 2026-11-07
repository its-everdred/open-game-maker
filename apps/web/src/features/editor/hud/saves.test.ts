import { describe, expect, it, vi } from 'vitest';

import type { SaveSlot } from '@ogm/contracts/browser';

import { saveSlotLoadable, saveSlotOptions, storeSaveWrite } from './saves';

const gameId = 'g_01BX5ZZKBKACTAV9WEVGEMMVRZ';
const slot = (status: SaveSlot['status']) => ({ slotId: 'auto', headRevision: 1, status }) as SaveSlot;

describe('platform saves', () => {
  it('keeps auto and manual slots in contract order even when only some have revisions', () => {
    const slots = [
      { slotId: '3', headRevision: 8 },
      { slotId: 'auto', headRevision: 12 },
    ] as SaveSlot[];

    expect(saveSlotOptions(slots).map(({ id, slot }) => [id, slot?.headRevision])).toEqual([
      ['auto', 12],
      ['1', undefined],
      ['2', undefined],
      ['3', 8],
    ]);
  });

  it('offers Load only for a slot this build reads itself or migrates', () => {
    expect(saveSlotLoadable(slot('ok'))).toBe(true);
    expect(saveSlotLoadable(slot('needs_migration'))).toBe(true);
    expect(saveSlotLoadable(slot('unsupported_old'))).toBe(false);
    expect(saveSlotLoadable(slot('incompatible_after_rollback'))).toBe(false);
    expect(saveSlotLoadable(undefined)).toBe(false);
  });

  it('stores an identity-free game payload in the host-selected slot with a concurrency revision', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const payload = { saveSchemaVersion: 2, data: { room: 'crypt' } };

    const context = { branch: 'main', buildId: 'build_01BX5ZZKBKACTAV9WEVGEMMVRZ' };
    await storeSaveWrite(gameId, '3', payload, [{ slotId: '3', headRevision: 8 } as SaveSlot], write, context);

    expect(write).toHaveBeenCalledWith(gameId, '3', payload, 8, context);
    expect(write.mock.calls[0]?.[2]).not.toHaveProperty('userId');
  });
});
