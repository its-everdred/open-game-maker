export type Embedding = { model: string; vector: readonly number[] };
export type EmbeddedAsset = Embedding & { id: string };
export type VisualMatch = { id: string; similarity: number };

/** Rank already-eligible asset images encoded by the same model as the query crop. */
export function rankVisualMatches(query: Embedding, candidates: readonly EmbeddedAsset[], limit = 3): VisualMatch[] {
  if (
    !query.model ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    query.vector.length === 0 ||
    query.vector.length > 16384 ||
    query.vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('invalid visual query');
  }
  const queryNorm = Math.hypot(...query.vector);
  if (!Number.isFinite(queryNorm) || queryNorm === 0) throw new Error('invalid visual query');
  const seen = new Set<string>();
  return candidates
    .map(({ id, model, vector }) => {
      if (
        !id ||
        seen.has(id) ||
        model !== query.model ||
        vector.length !== query.vector.length ||
        vector.some((value) => !Number.isFinite(value))
      )
        throw new Error('invalid visual candidate');
      seen.add(id);
      const norm = Math.hypot(...vector);
      if (!Number.isFinite(norm) || norm === 0) throw new Error('invalid visual candidate');
      const similarity = vector.reduce(
        (sum, value, index) => sum + (value / norm) * (query.vector[index]! / queryNorm),
        0,
      );
      return { id, similarity };
    })
    .sort((a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}
