import { describe, expect, it } from 'vitest';
import { sceneObjectFromMatch, sceneObjectFromRegion } from '../src/scene/worker-result.js';
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

  it('binds each reviewed object to its own crop while sharing candidates', () => {
    const batch = {
      ...result,
      mock_sha256: 'a'.repeat(64),
      scope: { pack: 'pack', kind: 'sprite' as const, facing: 'E' as const },
      regions: [
        { crop: [0, 0, 2, 2] as const, query: result.query },
        { crop: [2, 0, 2, 2] as const, query: { model: 'local', vector: [0, 1] } },
      ],
    };
    const first = sceneObjectFromRegion(object, batch, 0);
    const second = sceneObjectFromRegion({ ...object, id: 'stall' }, batch, 1);
    expect(first.crop.vector).toEqual([1, 0]);
    expect(second.crop.vector).toEqual([0, 1]);
    expect(second.candidates).toBe(first.candidates);
    expect(second.searchComplete).toBe(true);
    expect(() => sceneObjectFromRegion(object, batch, 2)).toThrow('invalid scene match region');
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
