import type { AssetCard } from '@ogm/contracts';

import { fenceB1Edges, structuralImageBounds, wallC1Edges, wallF1Edges } from './structural-bounds.js';

const FENCE = 't1:smallscaleint-2d-hd-zombie-rural-tileset/tiles/isometric-tiles/fence-b1@2026-11-01';
const WALL = 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-f1@2026-11-01';
const TIMBER = 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-c1@2026-11-01';
const FACINGS = ['E', 'N', 'S', 'W'] as const;
type StructuralFacings = NonNullable<AssetCard['sprite']>['structural_facings'];

/** Return measured card fields for an asset, without asserting unmeasured anchors or sockets. */
export function structuralCardFacts(id: string): StructuralFacings | undefined {
  if (!Object.hasOwn(structuralImageBounds.value, id)) return undefined;
  const image = structuralImageBounds.value[id]!;
  const result: NonNullable<StructuralFacings> = {};
  const edges = id === FENCE ? fenceB1Edges : id === WALL ? wallF1Edges : id === TIMBER ? wallC1Edges : undefined;
  for (const facing of FACINGS) {
    result[facing] = {
      alpha_bounds: { value: [...image.facings[facing]], verified: structuralImageBounds.verified },
      ...(edges ? { edges: { value: [edges.value[facing]], verified: edges.verified } } : {}),
    };
  }
  return result;
}
