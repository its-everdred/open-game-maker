import { parseSceneBrief } from './brief.js';
import { rankVisualMatches } from './match.js';
import { parseSceneBatchMatch } from './parse-worker-result.js';

/** Identify candidates for each reviewed region, without treating a low score as a kit gap. */
export function identifySceneRegions(input: { brief: unknown; match: unknown; mockSha256: string }) {
  const brief = parseSceneBrief(input.brief);
  const match = parseSceneBatchMatch(input.match);
  if (!/^[a-f0-9]{64}$/.test(input.mockSha256) || input.mockSha256 !== match.mock_sha256)
    throw new Error('scene match belongs to a different mock');
  if (brief.regions.length !== match.regions.length) throw new Error('scene match does not cover every brief region');
  const complete =
    !match.truncated &&
    match.examined > 0 &&
    match.examined === match.eligible &&
    match.examined === match.candidates.length;
  const regions = brief.regions.map((region, index) => {
    const result = match.regions[index]!;
    const { x, y, width, height } = region.bounds;
    if (result.crop.some((value, i) => value !== [x, y, width, height][i]))
      throw new Error(`scene match crop does not match brief region ${region.id}`);
    const hashes = new Map(match.candidates.map((candidate) => [candidate.id, candidate.source_sha256]));
    const candidates = rankVisualMatches(result.query, match.candidates).map((candidate) => ({
      ...candidate,
      sourceSha256: hashes.get(candidate.id)!,
    }));
    return { id: region.id, layer: region.layer, bounds: region.bounds, candidates, review: 'pending' as const };
  });
  return { mockSha256: match.mock_sha256, scope: match.scope, complete, regions };
}
