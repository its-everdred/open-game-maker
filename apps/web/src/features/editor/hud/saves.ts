import type { SaveData, SaveSlot } from '@ogm/contracts/browser';

import type { SaveContext } from '../api';

export const SAVE_SLOT_IDS = ['auto', '1', '2', '3'] as const satisfies readonly SaveSlot['slotId'][];
export type SaveSlotId = (typeof SAVE_SLOT_IDS)[number];
export type SaveWrite = (
  gameId: string,
  slotId: SaveSlotId,
  payload: SaveData<unknown>,
  headRevision: number | undefined,
  context: SaveContext,
) => Promise<unknown>;

export function saveSlotOptions(slots: readonly SaveSlot[]): Array<{ id: SaveSlotId; slot?: SaveSlot }> {
  const byId = new Map(slots.map((slot) => [slot.slotId, slot]));
  return SAVE_SLOT_IDS.map((id) => ({ id, slot: byId.get(id) }));
}

export function storeSaveWrite(
  gameId: string,
  slotId: SaveSlotId,
  payload: SaveData<unknown>,
  slots: readonly SaveSlot[],
  write: SaveWrite,
  context: SaveContext,
): Promise<unknown> {
  const headRevision = slots.find((slot) => slot.slotId === slotId)?.headRevision;
  return write(gameId, slotId, payload, headRevision, context);
}

export function saveSlotLabel(slotId: SaveSlotId): string {
  return slotId === 'auto' ? 'Auto save' : `Save slot ${slotId}`;
}

/** A slot the running build can read: written by this build, or the one version older that its `migrate` upgrades. */
export function saveSlotLoadable(slot: SaveSlot | undefined): boolean {
  return slot !== undefined && (slot.status === 'ok' || slot.status === 'needs_migration');
}
