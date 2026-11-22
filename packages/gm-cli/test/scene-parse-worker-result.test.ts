import { expect, it } from 'vitest';
import { parseSceneBatchMatch } from '../src/scene/parse-worker-result.js';

it('accepts worker metadata and rejects malformed placement evidence', () => {
  const query = { model: 'local', vector: [1, 0] };
  const value = {
    mock_sha256: 'a'.repeat(64),
    scope: { pack: 'pack', kind: 'sprite', facing: 'E' },
    query,
    candidates: [{ id: 'cart', ...query, source_sha256: 'b'.repeat(64) }],
    examined: 1,
    eligible: 1,
    truncated: false,
    regions: [{ crop: [0, 1, 2, 3], query, matches: [] }],
    preview: 'local',
  };
  expect(parseSceneBatchMatch(value).regions[0]?.crop).toEqual([0, 1, 2, 3]);
  expect(() => parseSceneBatchMatch({ ...value, mock_sha256: 'wrong' })).toThrow();
  expect(() => parseSceneBatchMatch({ ...value, candidates: [{ id: 'cart', ...query }] })).toThrow();
  expect(() => parseSceneBatchMatch({ ...value, scope: { pack: '../pack', kind: 'sprite', facing: 'E' } })).toThrow();
  expect(() => parseSceneBatchMatch({ ...value, regions: [{ crop: [0, 0, 0, 1], query }] })).toThrow();
  expect(() =>
    parseSceneBatchMatch({
      ...value,
      candidates: [{ id: 'cart', model: 'local', vector: [NaN], source_sha256: 'b'.repeat(64) }],
    }),
  ).toThrow();
});
