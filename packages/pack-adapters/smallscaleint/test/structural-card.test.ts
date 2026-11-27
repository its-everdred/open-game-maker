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
  const timber = structuralCardFacts(
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-c1@2026-11-01',
  )!;
  expect([timber.E?.edges?.value, timber.N?.edges?.value, timber.S?.edges?.value, timber.W?.edges?.value]).toEqual([
    ['xMax'],
    ['yMin'],
    ['yMax'],
    ['xMin'],
  ]);
  const arch = structuralCardFacts(
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-f6@2026-11-01',
  )!;
  expect([arch.E?.edges?.value, arch.N?.edges?.value, arch.S?.edges?.value, arch.W?.edges?.value]).toEqual([
    ['xMax'],
    ['yMin'],
    ['yMax'],
    ['xMin'],
  ]);
  const pillar = structuralCardFacts(
    't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/stone-a14@2026-11-01',
  )!;
  expect(pillar.E?.alpha_bounds?.value).toEqual([69, 9, 174, 236]);
  expect(pillar.W?.alpha_bounds?.value).toEqual([70, 9, 174, 236]);
  expect(structuralCardFacts('unknown')).toBeUndefined();
  expect(structuralCardFacts('toString')).toBeUndefined();
});
