import { describe, expect, it } from 'vitest';
import { sceneObjectFromMatch } from '../src/scene/worker-result.js';
import { buildScenePlan } from '../src/scene/plan.js';

describe('local scene match result', () => {
  const object = { id: 'cart', footpoint: { x: 2, y: 3 }, selectedAsset: 'asset' };
  const result = {
    query: { model: 'local', vector: [1, 0] },
    candidates: [{ id: 'asset', model: 'local', vector: [1, 0] }],
    examined: 1,
    eligible: 1,
    truncated: false,
  };

  it('preserves embeddings and complete search evidence', () => {
    expect(sceneObjectFromMatch(object, result)).toEqual({
      ...object,
      crop: result.query,
      candidates: result.candidates,
      searchComplete: true,
    });
  });

  it('does not certify partial or inconsistent worker output', () => {
    expect(sceneObjectFromMatch(object, { ...result, truncated: true }).searchComplete).toBe(false);
    expect(sceneObjectFromMatch(object, { ...result, eligible: 2 }).searchComplete).toBe(false);
    expect(sceneObjectFromMatch(object, { ...result, candidates: [] }).searchComplete).toBe(false);
  });

  it('prevents incomplete worker results from producing a placement', () => {
    const placement = sceneObjectFromMatch(object, { ...result, eligible: 2, truncated: true });
    expect(() =>
      buildScenePlan({
        anchors: [
          { image: { x: 0, y: 0 }, ground: { x: 0, y: 0 } },
          { image: { x: 1, y: 0 }, ground: { x: 1, y: 0 } },
          { image: { x: 1, y: 1 }, ground: { x: 1, y: 1 } },
          { image: { x: 0, y: 1 }, ground: { x: 0, y: 1 } },
        ],
        objects: [placement],
        dressing: { field: { width: 1, height: 1, weights: [1] }, options: { count: 0, radius: 0, seed: 1 } },
      }),
    ).toThrow('visual search is incomplete');
  });
});
