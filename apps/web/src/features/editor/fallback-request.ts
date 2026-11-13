import { lockAssetIdSchema, type CreateJobRequest } from '@ogm/contracts/browser';

import { editJobRequest } from '../build-chat/edit';

/** Prepare an agent job for a creator's placement when no native editor is available. */
export function fallbackEditRequest(
  target: { gameId: string; branchId: string },
  placement: { assetId: string; name: string; x: number; y: number },
  idempotencyKey: string,
): CreateJobRequest {
  const { x, y, assetId, name } = placement;
  if (![x, y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)) {
    throw new RangeError('preview coordinates must be between 0 and 1');
  }
  if (assetId.length > 2_000 || !lockAssetIdSchema.safeParse(assetId).success || !name.trim()) {
    throw new TypeError('an asset and name are required');
  }
  const text = `Place ${JSON.stringify(name.slice(0, 200))} (asset id ${JSON.stringify(assetId)}) at normalized preview coordinates x=${x}, y=${y}.`;
  return editJobRequest(target, text, 'now', idempotencyKey);
}
