import { expect, it } from 'vitest';
import { assessMatchCoverage } from '../src/scene/match-coverage.js';
import type { SceneBatchMatchResult } from '../src/scene/worker-result.js';

it('does not turn partial or unreviewed scoped searches into a kit gap', () => {
  const query = { model: 'local', vector: [1, 0] };
  const east: SceneBatchMatchResult = {
    scope: { pack: 'pack', kind: 'sprite', facing: 'E' },
    mock_sha256: 'a'.repeat(64),
    query,
    regions: [{ crop: [0, 0, 1, 1], query }],
    candidates: [{ id: 'grave', ...query, source_sha256: 'b'.repeat(64) }],
    examined: 1,
    eligible: 1,
    truncated: false,
  };
  const west: SceneBatchMatchResult = { ...east, scope: { ...east.scope, facing: 'W' } };
  const base = { mockSha256: 'a'.repeat(64), crop: [0, 0, 1, 1] as const, required: [east.scope, west.scope] };
  const noMatch = { kind: 'no-match' as const, reason: 'Reviewed every eligible candidate.' };
  expect(assessMatchCoverage({ ...base, searches: [{ result: east, review: noMatch }] }).status).toBe('incomplete');
  expect(
    assessMatchCoverage({
      ...base,
      searches: [
        { result: east, review: noMatch },
        { result: { ...west, truncated: true }, review: noMatch },
      ],
    }).status,
  ).toBe('incomplete');
  expect(
    assessMatchCoverage({
      ...base,
      searches: [
        { result: east, review: noMatch },
        { result: west, review: { kind: 'pending' } },
      ],
    }).status,
  ).toBe('needs-review');
  expect(
    assessMatchCoverage({
      ...base,
      searches: [
        { result: east, review: noMatch },
        { result: west, review: noMatch },
      ],
    }),
  ).toMatchObject({
    status: 'no-match-in-reviewed-scopes',
    reviews: [{ reason: noMatch.reason }, { reason: noMatch.reason }],
  });
  expect(
    assessMatchCoverage({
      ...base,
      searches: [
        { result: east, review: { kind: 'match', assetId: 'grave' } },
        { result: west, review: noMatch },
      ],
    }).status,
  ).toBe('matched');
  expect(() =>
    assessMatchCoverage({
      ...base,
      required: [east.scope],
      searches: [{ result: east, review: { kind: 'match', assetId: 'unavailable' } }],
    }),
  ).toThrow('not an eligible candidate');
  expect(() => assessMatchCoverage({ ...base, required: [east.scope, east.scope], searches: [] })).toThrow('duplicate');
  expect(() =>
    assessMatchCoverage({ ...base, mockSha256: 'b'.repeat(64), searches: [{ result: east, review: noMatch }] }),
  ).toThrow('different mock');
  expect(() =>
    assessMatchCoverage({ ...base, crop: [0, 0, 2, 2], searches: [{ result: east, review: noMatch }] }),
  ).toThrow('reviewed crop');
  expect(() =>
    assessMatchCoverage({
      ...base,
      required: [east.scope],
      searches: [{ result: east, review: { kind: 'no-match', reason: ' ' } }],
    }),
  ).toThrow('requires a reason');
  const duplicateCandidates = {
    ...east,
    candidates: [east.candidates[0]!, east.candidates[0]!],
    examined: 2,
    eligible: 2,
  };
  expect(() =>
    assessMatchCoverage({
      ...base,
      required: [east.scope],
      searches: [{ result: duplicateCandidates, review: noMatch }],
    }),
  ).toThrow('invalid visual candidate');
});
