import { expect, it } from 'vitest';
import { compileWeightExpression, mapWeightExpression } from '../src/packs/unity/weight-expression.js';
import type { ShaderGraphBase } from '../src/packs/unity/shadergraph.js';

it('compiles bounded scalar arithmetic around a texture channel', () => {
  const byId = new Map<string, Record<string, unknown>>([
    ['sample', { m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' }],
    ['scale', { m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } }],
    [
      'property',
      {
        m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
        m_DefaultReferenceName: '_Scale',
        m_Value: 1,
      },
    ],
    ['multiply', { m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' }],
    ['offset', { m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: 0.1 }],
    ['add', { m_Type: 'UnityEditor.ShaderGraph.AddNode' }],
    ['minimum', { m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: 0 }],
    ['maximum', { m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: 1 }],
    ['clamp', { m_Type: 'UnityEditor.ShaderGraph.ClampNode' }],
  ]);
  const edge = (node: string, inputSlot: number, outputSlot: number) => ({ node, inputSlot, outputSlot });
  const incoming = new Map([
    ['multiply', [edge('sample', 0, 4), edge('scale', 1, 0)]],
    ['add', [edge('multiply', 0, 2), edge('offset', 1, 0)]],
    ['clamp', [edge('add', 0, 2), edge('minimum', 1, 0), edge('maximum', 2, 0)]],
  ]);
  const sample: ShaderGraphBase = { textures: ['_Mask'], factors: [] };
  const expression = compileWeightExpression(
    edge('clamp', 2, 3),
    byId,
    incoming,
    new Map([['_Scale', '0.5']]),
    () => sample,
    new Set(),
  );
  expect(expression).toEqual({
    op: 'clamp',
    args: [{ op: 'add', args: [{ op: 'multiply', args: [{ term: sample, channel: 0 }, 0.5] }, 0.1] }, 0, 1],
  });
  expect(mapWeightExpression(expression, (term) => term.textures[0])).toEqual({
    op: 'clamp',
    args: [{ op: 'add', args: [{ op: 'multiply', args: [{ term: '_Mask', channel: 0 }, 0.5] }, 0.1] }, 0, 1],
  });
  const invalid = new Map(incoming);
  invalid.set('multiply', [edge('sample', 0, 0), edge('scale', 1, 0)]);
  expect(() => compileWeightExpression(edge('clamp', 2, 3), byId, invalid, new Map(), () => sample, new Set())).toThrow(
    'unsupported Unity scalar texture output',
  );
});

it('preserves scalar operation order and rejects vector defaults', () => {
  const edge = (node: string, inputSlot: number, outputSlot: number) => ({ node, inputSlot, outputSlot });
  const sample: ShaderGraphBase = { textures: ['mask'], factors: [] };
  for (const [name, op, output, slots] of [
    ['SubtractNode', 'subtract', 2, [0, 1]],
    ['DivideNode', 'divide', 2, [0, 1]],
    ['ContrastNode', 'contrast', 2, [0, 1]],
    ['OneMinusNode', 'invert', 1, [0]],
  ] as const) {
    const byId = new Map<string, Record<string, unknown>>([
      ['node', { m_Type: `UnityEditor.ShaderGraph.${name}` }],
      ['sample', { m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' }],
      ['constant', { m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: 0.5 }],
    ]);
    const inputs = [edge('sample', 0, 4), ...(slots.length === 2 ? [edge('constant', 1, 0)] : [])];
    const result = compileWeightExpression(
      edge('node', 0, output),
      byId,
      new Map([['node', inputs]]),
      new Map(),
      () => sample,
      new Set(),
    );
    expect(result).toEqual({ op, args: [{ term: sample, channel: 0 }, ...(slots.length === 2 ? [0.5] : [])] });
  }
  const byId = new Map<string, Record<string, unknown>>([
    ['node', { m_Type: 'UnityEditor.ShaderGraph.AddNode', m_Slots: [{ m_Id: 'slot' }] }],
    ['sample', { m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' }],
    ['slot', { m_Id: 1, m_SlotType: 0, m_Value: { x: 1, y: 2 } }],
  ]);
  expect(() =>
    compileWeightExpression(
      edge('node', 0, 2),
      byId,
      new Map([['node', [edge('sample', 0, 4)]]]),
      new Map(),
      () => sample,
      new Set(),
    ),
  ).toThrow('unsupported Unity vector scalar default');
});
