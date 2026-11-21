import { parseSceneBrief } from './brief.js';
import { reviewedBriefClone } from './brief-clone.js';
import type { ReviewedSceneObject } from './reviewed-clone.js';
import type { ScenePlanInput } from './plan.js';
import type { SceneTiledMap } from './tiled-merge.js';
import type { SceneBatchMatchResult } from './worker-result.js';
import type { SceneRoute, WalkableGrid } from './routes.js';

/** Bind each reviewed region to the exact crop used by a rights-checked local search. */
export function reviewedBatchBriefClone<T extends SceneTiledMap>(input: {
  brief: unknown;
  map: T;
  anchors: ScenePlanInput['anchors'];
  objects: readonly (Omit<ReviewedSceneObject, 'match'> & { regionIndex: number })[];
  match: SceneBatchMatchResult;
  /** SHA-256 computed by the caller from the actual mock file being reviewed. */
  mockSha256: string;
  dressing: ScenePlanInput['dressing'];
  lockedAssets: ReadonlySet<string>;
  reserved: ReadonlySet<string>;
  routeChecks?: { grid: WalkableGrid; routes: readonly SceneRoute[] };
}) {
  if (!/^[a-f0-9]{64}$/.test(input.mockSha256) || input.match.mock_sha256 !== input.mockSha256)
    throw new Error('scene match was computed from a different mock');
  const brief = parseSceneBrief(input.brief);
  const regions = new Map(brief.regions.map((region) => [region.id, region]));
  const indexes = new Set<number>();
  const objects = input.objects.map(({ regionIndex, ...object }) => {
    const region = regions.get(object.id);
    if (!region) throw new Error(`scene object ${object.id} has no brief region`);
    if (!Number.isSafeInteger(regionIndex) || regionIndex < 0 || indexes.has(regionIndex))
      throw new Error('invalid or repeated scene match region');
    indexes.add(regionIndex);
    const result = input.match.regions[regionIndex];
    const { x, y, width, height } = region.bounds;
    if (
      !result ||
      result.crop.length !== 4 ||
      result.crop.some((value, index) => value !== [x, y, width, height][index])
    )
      throw new Error(`scene match crop does not match brief region ${object.id}`);
    return { ...object, match: { ...input.match, query: result.query } };
  });
  return reviewedBriefClone({ ...input, brief, objects });
}
