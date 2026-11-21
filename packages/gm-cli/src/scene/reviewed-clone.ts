import { buildScenePlan, type ScenePlanInput } from './plan.js';
import { mergeSceneDecor, type SceneTiledMap } from './tiled-merge.js';
import { sceneObjectFromMatch, type SceneMatchResult } from './worker-result.js';
import type { SceneTile } from './tiled.js';

export type ReviewedSceneObject = {
  id: string;
  footpoint: { x: number; y: number };
  selectedAsset: string;
  match: SceneMatchResult;
  /** A reviewed grid cell, not an automatic rounding of the fitted position. */
  grid: { x: number; y: number };
  rotation: SceneTile['rotation'];
  solid: boolean;
  footprint: SceneTile['footprint'];
};

/** The caller validates mock rights and obtains matches from the local rights-checking worker.
 * Dressing points are suggestions only and require reviewed assets and footprints before export.
 */
export function reviewedClone<T extends SceneTiledMap>(input: {
  map: T;
  anchors: ScenePlanInput['anchors'];
  objects: readonly ReviewedSceneObject[];
  dressing: ScenePlanInput['dressing'];
  lockedAssets: ReadonlySet<string>;
  reserved: ReadonlySet<string>;
}) {
  const objects = input.objects.map(({ id, footpoint, selectedAsset, match }) =>
    sceneObjectFromMatch({ id, footpoint, selectedAsset }, match),
  );
  const plan = buildScenePlan({ anchors: input.anchors, objects, dressing: input.dressing });
  const placements = plan.objects.map((object, index) => {
    const reviewed = input.objects[index]!;
    return {
      object: { ...object, position: reviewed.grid },
      rotation: reviewed.rotation,
      solid: reviewed.solid,
      footprint: reviewed.footprint,
    };
  });
  const result = mergeSceneDecor(input.map, placements, input.lockedAssets, input.reserved);
  return { ...result, plan, placements };
}
