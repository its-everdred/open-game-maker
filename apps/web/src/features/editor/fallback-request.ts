import { lockAssetIdSchema, type CreateJobRequest } from '@ogm/contracts/browser';

import { editJobRequest } from '../build-chat/edit';

/** Prepare an agent job for a creator's placement when no native editor is available. */
export function fallbackEditRequest(
  target: { gameId: string; branchId: string },
  placement: { assetId: string; name: string; x: number; y: number },
  idempotencyKey: string,
): CreateJobRequest {
  const { x, y, assetId, name } = placement;
  validateCoordinates(x, y);
  if (assetId.length > 2_000 || !lockAssetIdSchema.safeParse(assetId).success || !name.trim()) {
    throw new TypeError('an asset and name are required');
  }
  const text = `Place ${JSON.stringify(name.slice(0, 200))} (asset id ${JSON.stringify(assetId)}) at normalized preview coordinates x=${x}, y=${y}.`;
  return editJobRequest(target, text, 'now', idempotencyKey);
}

/** A review build is temporary: ask the agent to carry an item choice into the game instead of editing it. */
export function previewEditRequest(
  target: { gameId: string; branchId: string },
  placement: { prefab: string; name: string; x: number; y: number },
  idempotencyKey: string,
): CreateJobRequest {
  const { x, y, prefab, name } = placement;
  validateCoordinates(x, y);
  if (!prefab.trim() || prefab.length > 1_000 || [...prefab].some((char) => char.charCodeAt(0) < 32) || !name.trim()) {
    throw new TypeError('an item and name are required');
  }
  const source = prefab.startsWith('scope:') ? 'scope item' : 'preview item';
  const text = `Place ${JSON.stringify(name.slice(0, 200))} (${source} ${JSON.stringify(prefab)}) at normalized preview coordinates x=${x}, y=${y}.`;
  return editJobRequest(target, text, 'now', idempotencyKey);
}

function validateCoordinates(x: number, y: number): void {
  if (![x, y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)) {
    throw new RangeError('preview coordinates must be between 0 and 1');
  }
}
