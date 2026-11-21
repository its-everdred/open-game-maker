import { fitImageToGround, projectGround, type Correspondence, type Point } from './registration.js';
import { rankVisualMatches, type EmbeddedAsset, type Embedding, type VisualMatch } from './match.js';
import { scatter, type DensityGrid, type ScatterOptions, type ScatterPoint } from './scatter.js';

export type SceneObjectInput = {
  id: string;
  footpoint: Point;
  crop: Embedding;
  /** Only assets already checked for the game's effective rights may be passed here. */
  candidates: readonly EmbeddedAsset[];
  selectedAsset: string;
  /** False for a truncated search; a full shortlist is required before placement. */
  searchComplete: boolean;
};
export type ScenePlanInput = {
  anchors: readonly Correspondence[];
  objects: readonly SceneObjectInput[];
  dressing: { field: DensityGrid; options: ScatterOptions };
};
export type PlannedObject = { id: string; position: Point; selectedAsset: string; matches: VisualMatch[] };
export type ScenePlan = { objects: PlannedObject[]; dressing: ScatterPoint[] };

/** Convert reviewed object footpoints and selections into ground-plane placements. */
export function buildScenePlan(input: ScenePlanInput): ScenePlan {
  const transform = fitImageToGround(input.anchors);
  const ids = new Set<string>();
  const objects = input.objects.map(({ id, footpoint, crop, candidates, selectedAsset, searchComplete }) => {
    if (!id || ids.has(id)) throw new Error('scene object ids must be unique and non-empty');
    ids.add(id);
    if (searchComplete !== true) throw new Error(`visual search is incomplete for ${id}`);
    const matches = rankVisualMatches(crop, candidates);
    if (!candidates.some((candidate) => candidate.id === selectedAsset)) {
      throw new Error(`selected asset is not an eligible candidate for ${id}`);
    }
    return { id, position: projectGround(transform, footpoint), selectedAsset, matches };
  });
  return { objects, dressing: scatter(input.dressing.field, input.dressing.options) };
}
