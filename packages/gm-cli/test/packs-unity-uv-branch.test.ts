import { expect, it } from 'vitest';
import { compileUvAffine } from '../src/packs/unity/uv-affine.js';
import { compileWorldUv } from '../src/packs/unity/world-uv.js';

it('selects the saved Boolean UV branch without evaluating the other branch', () => {
  const byId = new Map<string, Record<string, unknown>>([
    ['branch', { m_Type: 'UnityEditor.ShaderGraph.BranchNode' }],
    ['selector', { m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } }],
    [
      'property',
      {
        m_Type: 'UnityEditor.ShaderGraph.Internal.BooleanShaderProperty',
        m_DefaultReferenceName: '_Switch',
        m_Value: false,
      },
    ],
    ['uv0', { m_Type: 'UnityEditor.ShaderGraph.UVNode', m_OutputChannel: 0 }],
    ['uv1', { m_Type: 'UnityEditor.ShaderGraph.UVNode', m_OutputChannel: 1 }],
  ]);
  const incoming = new Map([
    [
      'branch',
      [
        { node: 'selector', inputSlot: 0, outputSlot: 0 },
        { node: 'uv1', inputSlot: 1, outputSlot: 0 },
        { node: 'uv0', inputSlot: 2, outputSlot: 0 },
      ],
    ],
  ]);
  const parse = (value: number) =>
    compileUvAffine(
      { node: 'branch', inputSlot: 0, outputSlot: 3 },
      byId,
      incoming,
      new Map([['_Switch', value]]),
      new Map(),
      new Set(),
    );
  expect(parse(0).channel).toBe(0);
  expect(parse(1).channel).toBe(1);
  expect(() => parse(2)).toThrow('invalid Unity UV branch selector');
  byId.set('world', { m_Type: 'UnityEditor.ShaderGraph.PositionNode', m_Space: 4 });
  incoming.get('branch')![1]!.node = 'world';
  const world = compileWorldUv(
    { node: 'branch', inputSlot: 0, outputSlot: 3 },
    byId,
    incoming,
    new Map([['_Switch', 1]]),
    new Map(),
    new Set(),
  );
  expect(world).toEqual([1, 0, 0, 0, 0, 1, 0, 0]);
});
