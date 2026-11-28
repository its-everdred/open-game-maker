import { expect, it } from 'vitest';
import { compileWeightExpression } from '../src/packs/unity/weight-expression.js';

it('retains scalar interpolation including extrapolation in a blend weight', () => {
  const node = (id: string, type: string, extra: Record<string, unknown> = {}) =>
    [id, { m_Type: `UnityEditor.ShaderGraph.${type}`, ...extra }] as const;
  const byId = new Map<string, Record<string, unknown>>([
    node('lerp', 'LerpNode'),
    node('a', 'Vector1Node', { m_Value: 0.2 }),
    node('b', 'Vector1Node', { m_Value: 0.8 }),
    node('t', 'Vector1Node', { m_Value: 1.5 }),
  ]);
  const incoming = new Map([
    [
      'lerp',
      [
        { node: 'a', inputSlot: 0, outputSlot: 0 },
        { node: 'b', inputSlot: 1, outputSlot: 0 },
        { node: 't', inputSlot: 2, outputSlot: 0 },
      ],
    ],
  ]);
  const result = compileWeightExpression(
    { node: 'lerp', inputSlot: 0, outputSlot: 3 },
    byId,
    incoming,
    new Map(),
    () => {
      throw new Error('unexpected texture');
    },
    new Set(),
  );
  expect(result).toEqual({
    op: 'add',
    args: [0.2, { op: 'multiply', args: [{ op: 'subtract', args: [0.8, 0.2] }, 1.5] }],
  });
});
