import { assetMetadataSchema } from '@ogm/contracts/assets';
import { expect, it } from 'vitest';

import { structuralCardFacts } from '../src/structural-card.js';

it('supplies measured card metadata without inventing anchors or sockets', () => {
  const id = 't1:smallscaleint-2d-hd-zombie-rural-tileset/tiles/isometric-tiles/fence-b1@2026-11-01';
  const facts = structuralCardFacts(id)!;
  expect(facts.W?.edges?.value).toEqual(['yMin']);
  expect(facts.W?.alpha_bounds?.value).toEqual([46, 67, 127, 215]);
  expect(facts.W?.anchor).toBeUndefined();
  expect(facts.W?.sockets).toBeUndefined();
  expect(assetMetadataSchema.safeParse({ sprite: { drawn_view: 'iso', structural_facings: facts } }).success).toBe(
    true,
  );
  const wall = structuralCardFacts(
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-f1@2026-11-01',
  )!;
  expect([wall.E?.edges?.value, wall.N?.edges?.value, wall.S?.edges?.value, wall.W?.edges?.value]).toEqual([
    ['xMax'],
    ['yMin'],
    ['yMax'],
    ['xMin'],
  ]);
  expect(structuralCardFacts('unknown')).toBeUndefined();
  expect(structuralCardFacts('toString')).toBeUndefined();
});
