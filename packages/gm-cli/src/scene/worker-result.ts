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

export type SceneBatchMatchResult = SceneMatchResult & {
  mock_sha256: string;
  candidates: readonly (EmbeddedAsset & { source_sha256: string })[];
  scope: { pack: string; kind: 'sprite'; facing: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' };
  regions: readonly { crop: readonly [number, number, number, number]; query: Embedding }[];
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

/** Bind a reviewed object to one crop from a shared, complete catalog search. */
export function sceneObjectFromRegion(
  object: Pick<SceneObjectInput, 'id' | 'footpoint' | 'selectedAsset'>,
  result: SceneBatchMatchResult,
  index: number,
): SceneObjectInput {
  if (!Number.isSafeInteger(index) || index < 0 || index >= result.regions.length)
    throw new Error('invalid scene match region');
  return sceneObjectFromMatch(object, { ...result, query: result.regions[index]!.query });
}
