import type { EmbeddedAsset, Embedding } from './match.js';
import type { SceneObjectInput } from './plan.js';

/** Local worker output is trusted only after its pack rights validation succeeds. */
export type SceneMatchResult = {
  query: Embedding;
  candidates: readonly EmbeddedAsset[];
  examined: number;
  eligible: number;
  truncated: boolean;
};

/** Preserve the worker's completeness evidence when preparing a reviewed placement. */
export function sceneObjectFromMatch(
  object: Pick<SceneObjectInput, 'id' | 'footpoint' | 'selectedAsset'>,
  result: SceneMatchResult,
): SceneObjectInput {
  const complete =
    result.truncated === false &&
    Number.isSafeInteger(result.examined) &&
    result.examined > 0 &&
    result.examined === result.eligible &&
    result.examined === result.candidates.length;
  return { ...object, crop: result.query, candidates: result.candidates, searchComplete: complete };
}
