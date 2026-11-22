import type { AssetCard } from '@ogm/contracts';

import { fenceB1Edges, structuralImageBounds } from './structural-bounds.js';

const FENCE = 't1:smallscaleint-2d-hd-zombie-rural-tileset/tiles/isometric-tiles/fence-b1@2026-11-01';
const FACINGS = ['E', 'N', 'S', 'W'] as const;
type StructuralFacings = NonNullable<AssetCard['sprite']>['structural_facings'];

/** Return measured card fields for an asset, without asserting unmeasured anchors or sockets. */
export function structuralCardFacts(id: string): StructuralFacings | undefined {
  if (!Object.hasOwn(structuralImageBounds.value, id)) return undefined;
  const image = structuralImageBounds.value[id]!;
  const result: NonNullable<StructuralFacings> = {};
  for (const facing of FACINGS) {
    result[facing] = {
      alpha_bounds: { value: [...image.facings[facing]], verified: structuralImageBounds.verified },
      ...(id === FENCE ? { edges: { value: [fenceB1Edges.value[facing]], verified: fenceB1Edges.verified } } : {}),
    };
  }
  return result;
}
