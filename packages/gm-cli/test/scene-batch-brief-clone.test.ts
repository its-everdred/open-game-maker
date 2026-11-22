import { expect, it } from 'vitest';
import { reviewedBatchBriefClone } from '../src/scene/batch-brief-clone.js';

function input() {
  const points = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 3 },
    { x: 0, y: 3 },
  ];
  const query = { model: 'offline', vector: [1, 0] };
  const stallQuery = { model: 'offline', vector: [0, 1] };
  return {
    brief: {
      image: { width: 4, height: 4 },
      story: 'A trader arrives.',
      mood: 'Calm',
      light: 'Dusk',
      focalRegion: 'cart',
      regions: [
        { id: 'cart', label: 'Cart', layer: 'prop', bounds: { x: 1, y: 1, width: 2, height: 2 } },
        { id: 'stall', label: 'Stall', layer: 'landmark', bounds: { x: 0, y: 0, width: 1, height: 1 } },
      ],
    },
    map: {
      width: 4,
      height: 4,
      layers: [{ type: 'tilelayer' as const, name: 'decor', width: 4, height: 4, data: Array<number>(16).fill(0) }],
      tilesets: [],
    },
    anchors: points.map((point) => ({ image: point, ground: point })),
    objects: [
      {
        id: 'cart',
        regionIndex: 0,
        footpoint: { x: 2, y: 3 },
        selectedAsset: 'cart',
        grid: { x: 1, y: 2 },
        rotation: 0 as const,
        solid: true,
        footprint: [{ x: 0, y: 0 }],
      },
      {
        id: 'stall',
        regionIndex: 1,
        footpoint: { x: 0, y: 1 },
        selectedAsset: 'stall',
        grid: { x: 3, y: 3 },
        rotation: 0 as const,
        solid: true,
        footprint: [{ x: 0, y: 0 }],
      },
    ],
    match: {
      query,
      mock_sha256: 'a'.repeat(64),
      scope: { pack: 'pack', kind: 'sprite' as const, facing: 'E' as const },
      candidates: [
        { id: 'cart', ...query },
        { id: 'stall', ...stallQuery },
      ],
      examined: 2,
      eligible: 2,
      truncated: false,
      regions: [
        { crop: [1, 1, 2, 2] as [number, number, number, number], query },
        { crop: [0, 0, 1, 1] as [number, number, number, number], query: stallQuery },
      ],
    },
    mockSha256: 'a'.repeat(64),
    dressing: { field: { width: 1, height: 1, weights: [1] }, options: { count: 0, radius: 0, seed: 1 } },
    lockedAssets: new Set(['cart', 'stall']),
    reserved: new Set<string>(),
  };
}

it('exports a reviewed object from the corresponding complete batch crop', () => {
  const result = reviewedBatchBriefClone(input());
  expect(result.plan.objects[0]!.matches[0]).toMatchObject({ id: 'cart', similarity: 1 });
  expect(result.plan.objects[1]!.matches[0]).toMatchObject({ id: 'stall', similarity: 1 });
  expect(result.collision).toEqual([
    { x: 1, y: 2 },
    { x: 3, y: 3 },
  ]);
});

it('refuses stale crops, invalid indexes and truncated searches', () => {
  const staleImage = input();
  staleImage.mockSha256 = 'b'.repeat(64);
  expect(() => reviewedBatchBriefClone(staleImage)).toThrow('different mock');
  const stale = input();
  stale.match.regions[0]!.crop = [0, 0, 2, 2];
  expect(() => reviewedBatchBriefClone(stale)).toThrow('crop does not match');
  const invalid = input();
  invalid.objects[0]!.regionIndex = 2;
  expect(() => reviewedBatchBriefClone(invalid)).toThrow('crop does not match');
  const reused = input();
  reused.objects[1]!.regionIndex = 0;
  expect(() => reviewedBatchBriefClone(reused)).toThrow('repeated scene match region');
  const incomplete = input();
  incomplete.match.truncated = true;
  expect(() => reviewedBatchBriefClone(incomplete)).toThrow('visual search is incomplete');
});

it('rejects malformed unused worker regions before exporting', () => {
  const data = input();
  data.match.regions.push({ crop: [0, 0, 0, 1], query: data.match.query });
  expect(() => reviewedBatchBriefClone(data)).toThrow();
});
