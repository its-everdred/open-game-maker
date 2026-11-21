import { describe, expect, it } from 'vitest';
import { rankVisualMatches } from '../src/scene/match.js';
const embedding = (vector: number[]) => ({ model: 'test-model', vector });
const candidate = (id: string, vector: number[]) => ({ id, ...embedding(vector) });

describe('scene visual matching', () => {
  it('ranks the three closest visual vectors regardless of vector magnitude', () => {
    const matches = rankVisualMatches(embedding([1, 0]), [
      candidate('opposite', [-1, 0]),
      candidate('near', [2, 1]),
      candidate('exact', [10, 0]),
      candidate('orthogonal', [0, 1]),
    ]);
    expect(matches.map((match) => match.id)).toEqual(['exact', 'near', 'orthogonal']);
    expect(matches[0]!.similarity).toBeCloseTo(1);
  });
  it('rejects incompatible or invalid embeddings instead of producing a misleading match', () => {
    expect(() => rankVisualMatches(embedding([0, 0]), [])).toThrow('query');
    expect(() => rankVisualMatches(embedding([1, 0]), [candidate('x', [1])])).toThrow('candidate');
    expect(() => rankVisualMatches(embedding([1]), [candidate('x', [1]), candidate('x', [1])])).toThrow('candidate');
    expect(() => rankVisualMatches(embedding([1]), [candidate('x', [NaN])])).toThrow('candidate');
    expect(() => rankVisualMatches(embedding([1]), [{ id: 'x', model: 'another-model', vector: [1] }])).toThrow(
      'candidate',
    );
  });
});
