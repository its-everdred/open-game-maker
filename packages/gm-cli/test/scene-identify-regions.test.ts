import { expect, it } from 'vitest';
import { identifySceneRegions } from '../src/scene/identify-regions.js';

it('ranks each reviewed crop and preserves incomplete search and pending review', () => {
  const mockSha256 = 'a'.repeat(64);
  const brief = {
    image: { width: 10, height: 10 },
    story: 'A grave.',
    mood: 'Dusk',
    light: 'Warm',
    focalRegion: 'grave',
    regions: [{ id: 'grave', label: 'Grave', layer: 'prop', bounds: { x: 1, y: 2, width: 3, height: 4 } }],
  };
  const vector = (x: number, y: number) => ({ model: 'model', vector: [x, y] });
  const match = {
    mock_sha256: mockSha256,
    scope: { pack: 'pack', kind: 'sprite', facing: 'E' },
    query: vector(1, 0),
    candidates: [
      { id: 'b', ...vector(0, 1), source_sha256: mockSha256 },
      { id: 'a', ...vector(1, 0), source_sha256: mockSha256 },
    ],
    examined: 2,
    eligible: 3,
    truncated: true,
    regions: [{ crop: [1, 2, 3, 4], query: vector(1, 0) }],
  };
  const result = identifySceneRegions({ brief, match, mockSha256 });
  expect(result).toMatchObject({
    complete: false,
    regions: [{ id: 'grave', review: 'pending', candidates: [{ id: 'a' }, { id: 'b' }] }],
  });
  expect(() => identifySceneRegions({ brief, match, mockSha256: 'b'.repeat(64) })).toThrow('different mock');
  expect(() =>
    identifySceneRegions({
      brief,
      match: { ...match, regions: [{ ...match.regions[0], crop: [0, 2, 3, 4] }] },
      mockSha256,
    }),
  ).toThrow('crop');
});
