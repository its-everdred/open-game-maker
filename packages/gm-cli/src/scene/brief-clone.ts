import { parseSceneBrief } from './brief.js';
import { reviewedClone, type ReviewedSceneObject } from './reviewed-clone.js';
import type { ScenePlanInput } from './plan.js';
import type { SceneTiledMap } from './tiled-merge.js';
import { validateSceneRoutes, type SceneRoute, type WalkableGrid } from './routes.js';

/** Export reviewed matches only when their footpoints belong to the named brief regions. */
export function reviewedBriefClone<T extends SceneTiledMap>(input: {
  brief: unknown;
  map: T;
  anchors: ScenePlanInput['anchors'];
  objects: readonly ReviewedSceneObject[];
  dressing: ScenePlanInput['dressing'];
  lockedAssets: ReadonlySet<string>;
  reserved: ReadonlySet<string>;
  routeChecks?: { grid: WalkableGrid; routes: readonly SceneRoute[] };
}) {
  const brief = parseSceneBrief(input.brief);
  const regions = new Map(brief.regions.map((region) => [region.id, region]));
  for (const object of input.objects) {
    const region = regions.get(object.id);
    if (!region) throw new Error(`scene object ${object.id} has no brief region`);
    const { x, y, width, height } = region.bounds;
    if (
      !Number.isFinite(object.footpoint.x) ||
      !Number.isFinite(object.footpoint.y) ||
      object.footpoint.x < x ||
      object.footpoint.x > x + width ||
      object.footpoint.y < y ||
      object.footpoint.y > y + height
    )
      throw new Error(`scene object ${object.id} footpoint is outside its brief region`);
  }
  const result = reviewedClone(input);
  if (input.routeChecks) {
    if (input.routeChecks.grid.width !== input.map.width || input.routeChecks.grid.height !== input.map.height)
      throw new Error('scene route grid does not match the game map');
    validateSceneRoutes(input.routeChecks.grid, result.collision, input.routeChecks.routes);
  }
  return { ...result, brief };
}
