import { describe, expect, it } from 'vitest';
import { buildScenePlan, type ScenePlanInput } from '../src/scene/plan.js';

function input(): ScenePlanInput {
  return {
    anchors: [
      { ground: { x: 0, y: 0 }, image: { x: 10, y: 20 } },
      { ground: { x: 4, y: 0 }, image: { x: 18, y: 20 } },
      { ground: { x: 4, y: 4 }, image: { x: 18, y: 28 } },
      { ground: { x: 0, y: 4 }, image: { x: 10, y: 28 } },
    ],
    objects: [
      {
        id: 'cart',
        footpoint: { x: 14, y: 26 },
        crop: { model: 'local-v1', vector: [1, 0] },
        candidates: [
          { id: 'cart-asset', model: 'local-v1', vector: [1, 0] },
          { id: 'stall-asset', model: 'local-v1', vector: [0, 1] },
        ],
        selectedAsset: 'cart-asset',
        searchComplete: true,
      },
    ],
    dressing: { field: { width: 2, height: 1, weights: [0, 1] }, options: { count: 1, radius: 0, seed: 7 } },
  };
}

describe('scene placement plan', () => {
  it('maps a reviewed footpoint to the grid and retains the shortlist and reserved cells', () => {
    const result = buildScenePlan(input());
    expect(result.objects[0]!.position.x).toBeCloseTo(2);
    expect(result.objects[0]!.position.y).toBeCloseTo(3);
    expect(result.objects[0]!.selectedAsset).toBe('cart-asset');
    expect(result.objects[0]!.matches.map((match) => match.id)).toEqual(['cart-asset', 'stall-asset']);
    expect(result.dressing).toHaveLength(1);
    expect(result.dressing[0]!.x).toBeGreaterThanOrEqual(1);
  });
  it('allows a reviewed selection outside the top three', () => {
    const scene = input();
    scene.objects = [
      {
        ...scene.objects[0]!,
        candidates: [
          { id: 'first', model: 'local-v1', vector: [1, 0] },
          { id: 'second', model: 'local-v1', vector: [0.9, 0.1] },
          { id: 'third', model: 'local-v1', vector: [0.8, 0.2] },
          { id: 'reviewed', model: 'local-v1', vector: [-1, 0] },
        ],
        selectedAsset: 'reviewed',
      },
    ];
    const object = buildScenePlan(scene).objects[0]!;
    expect(object.selectedAsset).toBe('reviewed');
    expect(object.matches.map((match) => match.id)).not.toContain('reviewed');
  });
  it('refuses placements based on a truncated visual search', () => {
    const scene = input();
    scene.objects = [{ ...scene.objects[0]!, searchComplete: false }];
    expect(() => buildScenePlan(scene)).toThrow('visual search is incomplete');
  });
  it('refuses selections not in the available shortlist and duplicate object ids', () => {
    const bad = input();
    bad.objects = [{ ...bad.objects[0]!, selectedAsset: 'missing' }];
    expect(() => buildScenePlan(bad)).toThrow('not an eligible candidate');
    const duplicate = input();
    duplicate.objects = [duplicate.objects[0]!, duplicate.objects[0]!];
    expect(() => buildScenePlan(duplicate)).toThrow('unique');
  });
});
