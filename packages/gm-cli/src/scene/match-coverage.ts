import { parseSceneBatchMatch } from './parse-worker-result.js';
import type { SceneBatchMatchResult } from './worker-result.js';

type SearchScope = SceneBatchMatchResult['scope'];
type Review = { kind: 'pending' } | { kind: 'no-match'; reason: string } | { kind: 'match'; assetId: string };
type ReviewedSearch = { result: SceneBatchMatchResult; review: Review };

const key = ({ pack, kind, facing }: SearchScope) => JSON.stringify([pack, kind, facing]);

/** A negative finding is limited to explicitly named, complete and reviewed searches. */
export function assessMatchCoverage(input: {
  mockSha256: string;
  crop: readonly [number, number, number, number];
  required: readonly SearchScope[];
  searches: readonly ReviewedSearch[];
}) {
  const { mockSha256, crop, required, searches } = input;
  if (!/^[a-f0-9]{64}$/.test(mockSha256)) throw new Error('invalid mock hash');
  if (crop.length !== 4 || crop.some((value, index) => !Number.isSafeInteger(value) || value < (index < 2 ? 0 : 1)))
    throw new Error('invalid reviewed crop');
  if (required.length === 0) throw new Error('at least one search scope is required');
  const scopes = new Set(required.map(key));
  if (scopes.size !== required.length) throw new Error('duplicate required search scope');
  const byScope = new Map<string, ReviewedSearch>();
  for (const item of searches) {
    const result = parseSceneBatchMatch(item.result);
    const review = item.review;
    if (result.mock_sha256 !== mockSha256) throw new Error('search belongs to a different mock');
    if (result.regions.filter((region) => region.crop.every((value, index) => value === crop[index])).length !== 1)
      throw new Error('search does not contain the reviewed crop exactly once');
    const scope = key(result.scope);
    if (!scopes.has(scope) || byScope.has(scope)) throw new Error('unexpected or duplicate search scope');
    if (!['pending', 'no-match', 'match'].includes(review.kind)) throw new Error('invalid match review');
    if (
      review.kind === 'no-match' &&
      (typeof review.reason !== 'string' || !review.reason.trim() || review.reason.length > 2000)
    )
      throw new Error('a reviewed miss requires a reason');
    if (review.kind === 'match' && !result.candidates.some((candidate) => candidate.id === review.assetId))
      throw new Error('reviewed match is not an eligible candidate');
    byScope.set(scope, { result, review });
  }
  const incomplete = required.filter((scope) => {
    const item = byScope.get(key(scope));
    return (
      !item ||
      item.result.truncated ||
      item.result.examined < 1 ||
      item.result.examined !== item.result.eligible ||
      item.result.candidates.length !== item.result.examined
    );
  });
  if (incomplete.length > 0) return { status: 'incomplete' as const, scopes: incomplete };
  const matched = [...byScope.values()].filter((item) => item.review.kind === 'match');
  if (matched.length > 0) {
    return {
      status: 'matched' as const,
      matches: matched.map((item) => ({ scope: item.result.scope, review: item.review })),
    };
  }
  const pending = required.filter((scope) => byScope.get(key(scope))!.review.kind === 'pending');
  if (pending.length > 0) return { status: 'needs-review' as const, scopes: pending };
  const reviews = required.map((scope) => {
    const review = byScope.get(key(scope))!.review;
    if (review.kind !== 'no-match') throw new Error('invalid match review');
    return { scope, reason: review.reason };
  });
  return { status: 'no-match-in-reviewed-scopes' as const, reviews };
}
