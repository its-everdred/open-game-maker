import { parseSceneBrief } from './brief.js';
import { fitImageToGround, projectGround, type Correspondence, type Point } from './registration.js';

type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export type ImageObservation = {
  id: string;
  footpoint: Point | null;
  visibleHeightPx: number | null;
  facing: Facing | null;
  /** Null means unknown; an empty list is an observed absence of occlusions. */
  occludes: readonly string[] | null;
};

/** Project supplied observations, preserving unknowns and screen-space scale limits. */
export function projectSceneObservations(input: {
  brief: unknown;
  /** Hash calculated by the caller from the image described by the brief. */
  mockSha256: string;
  anchors: readonly Correspondence[] | null;
  characterHeightPx: number | null;
  observations: readonly ImageObservation[];
}) {
  const brief = parseSceneBrief(input.brief);
  if (!/^[a-f0-9]{64}$/.test(input.mockSha256)) throw new Error('invalid mock hash');
  const regions = new Map(brief.regions.map((region) => [region.id, region]));
  if (
    input.characterHeightPx !== null &&
    (!Number.isFinite(input.characterHeightPx) ||
      input.characterHeightPx <= 0 ||
      input.characterHeightPx > brief.image.height)
  )
    throw new Error('invalid character image height');
  const transform = input.anchors === null ? null : fitImageToGround(input.anchors);
  const byId = new Map<string, ImageObservation>();
  for (const object of input.observations) {
    const region = regions.get(object.id);
    if (!region || byId.has(object.id)) throw new Error('unknown or duplicate scene observation');
    const { x, y, width, height } = region.bounds;
    if (
      object.footpoint !== null &&
      (!Number.isFinite(object.footpoint.x) ||
        !Number.isFinite(object.footpoint.y) ||
        object.footpoint.x < x ||
        object.footpoint.x > x + width ||
        object.footpoint.y < y ||
        object.footpoint.y > y + height)
    )
      throw new Error(`footpoint is outside region ${object.id}`);
    if (
      object.visibleHeightPx !== null &&
      (!Number.isFinite(object.visibleHeightPx) || object.visibleHeightPx <= 0 || object.visibleHeightPx > height)
    )
      throw new Error(`invalid visible height for ${object.id}`);
    if (
      object.visibleHeightPx !== null &&
      input.characterHeightPx !== null &&
      !Number.isFinite(object.visibleHeightPx / input.characterHeightPx)
    )
      throw new Error(`invalid screen height ratio for ${object.id}`);
    if (object.facing !== null && !['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].includes(object.facing))
      throw new Error(`invalid facing for ${object.id}`);
    byId.set(object.id, object);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('cyclic scene occlusion');
    if (visited.has(id)) return;
    visiting.add(id);
    const neighbours = byId.get(id)!.occludes;
    if (neighbours !== null) {
      if (!Array.isArray(neighbours) || new Set(neighbours).size !== neighbours.length)
        throw new Error('invalid scene occlusion');
      for (const neighbour of neighbours) {
        if (!byId.has(neighbour)) throw new Error('occlusion refers to an unknown observation');
        visit(neighbour);
      }
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
  const observations = input.observations.map((object) => ({
    id: object.id,
    layer: regions.get(object.id)!.layer,
    footpoint: object.footpoint,
    ground: object.footpoint !== null && transform !== null ? projectGround(transform, object.footpoint) : null,
    facing: object.facing,
    screenHeightInCharacters:
      object.visibleHeightPx !== null && input.characterHeightPx !== null
        ? object.visibleHeightPx / input.characterHeightPx
        : null,
    occludes: object.occludes,
  }));
  return { mockSha256: input.mockSha256, hasAnchors: transform !== null, observations };
}
