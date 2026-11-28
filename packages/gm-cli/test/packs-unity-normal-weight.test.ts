import { expect, it } from 'vitest';
import { compileWeightExpression } from '../src/packs/unity/weight-expression.js';

it('resolves absolute world-normal components in scalar blend weights', () => {
  const entry = (id: string, type: string, extra: Record<string, unknown> = {}) =>
    [id, { m_Type: `UnityEditor.ShaderGraph.${type}`, ...extra }] as const;
  const byId = new Map<string, Record<string, unknown>>([
    entry('normal', 'NormalVectorNode', { m_Space: 2 }),
    entry('split', 'SplitNode'),
    entry('absolute', 'AbsoluteNode'),
    entry('contrast', 'ContrastNode', { m_Slots: [{ m_Id: 'amount' }] }),
    entry('amount', 'Vector1MaterialSlot', { m_Id: 1, m_SlotType: 0, m_Value: 1 }),
    entry('out', 'SplitNode'),
  ]);
  const incoming = new Map([
    ['split', [{ node: 'normal', inputSlot: 0, outputSlot: 0 }]],
    ['absolute', [{ node: 'split', inputSlot: 0, outputSlot: 2 }]],
    ['contrast', [{ node: 'absolute', inputSlot: 0, outputSlot: 1 }]],
    ['out', [{ node: 'contrast', inputSlot: 0, outputSlot: 2 }]],
  ]);
  const parse = () =>
    compileWeightExpression(
      { node: 'out', inputSlot: 0, outputSlot: 1 },
      byId,
      incoming,
      new Map(),
      () => {
        throw new Error('unexpected texture');
      },
      new Set(),
    );
  expect(parse()).toEqual({ op: 'contrast', args: [{ op: 'absolute', args: [{ normal: 1 }] }, 1] });
  byId.get('normal')!.m_Space = 0;
  expect(parse).toThrow('unsupported Unity scalar split');
  byId.set('color', { m_Type: 'UnityEditor.ShaderGraph.VertexColorNode' });
  incoming.get('split')![0]!.node = 'color';
  incoming.get('absolute')![0]!.outputSlot = 3;
  expect(parse()).toEqual({ op: 'contrast', args: [{ op: 'absolute', args: [{ vertexColor: 2 }] }, 1] });
});

it('compiles Overlay and Subtract blend modes with their opacity input', () => {
  const byId = new Map<string, Record<string, unknown>>([
    [
      'blend',
      {
        m_Type: 'UnityEditor.ShaderGraph.BlendNode',
        m_BlendMode: 15,
        m_Slots: [0, 1, 3].map((id) => ({ m_Id: `slot${id}` })),
      },
    ],
    ...[0, 1, 3].map(
      (id) => [`slot${id}`, { m_Id: id, m_SlotType: 0, m_Value: id === 0 ? 0.25 : id === 1 ? 0.8 : 0.5 }] as const,
    ),
  ]);
  const parse = () =>
    compileWeightExpression(
      { node: 'blend', inputSlot: 0, outputSlot: 2 },
      byId,
      new Map(),
      new Map(),
      () => {
        throw new Error('unexpected texture');
      },
      new Set(),
    );
  expect(parse()).toEqual({
    op: 'add',
    args: [
      0.25,
      { op: 'multiply', args: [{ op: 'subtract', args: [{ op: 'overlay', args: [0.25, 0.8] }, 0.25] }, 0.5] },
    ],
  });
  byId.get('blend')!.m_BlendMode = 19;
  expect(JSON.stringify(parse())).toContain('"op":"subtract"');
  byId.get('blend')!.m_BlendMode = 5;
  expect(parse).toThrow('unsupported Unity blend mode');
});

it('compiles remapping with fixed nonzero input and output ranges', () => {
  const byId = new Map<string, Record<string, unknown>>([
    ['remap', { m_Type: 'UnityEditor.ShaderGraph.RemapNode', m_Slots: [0, 1, 2].map((id) => ({ m_Id: `s${id}` })) }],
    ['s0', { m_Id: 0, m_SlotType: 0, m_Value: 0.25 }],
    ['s1', { m_Id: 1, m_SlotType: 0, m_Value: { x: 0, y: 1 } }],
    ['s2', { m_Id: 2, m_SlotType: 0, m_Value: { x: -8, y: 8 } }],
  ]);
  const parse = () =>
    compileWeightExpression(
      { node: 'remap', inputSlot: 0, outputSlot: 3 },
      byId,
      new Map(),
      new Map(),
      () => {
        throw new Error('unexpected texture');
      },
      new Set(),
    );
  expect(parse()).toEqual({
    op: 'add',
    args: [{ op: 'multiply', args: [{ op: 'subtract', args: [0.25, 0] }, 16] }, -8],
  });
  byId.get('s1')!.m_Value = { x: 0, y: 0 };
  expect(parse).toThrow('unsupported Unity remap range');
});

it('compiles Unity version zero simple noise on the default UV channel', () => {
  const byId = new Map<string, Record<string, unknown>>([
    [
      'noise',
      { m_Type: 'UnityEditor.ShaderGraph.NoiseNode', m_SGVersion: 0, m_Slots: [{ m_Id: 'uv' }, { m_Id: 'scale' }] },
    ],
    ['uv', { m_Id: 0, m_SlotType: 0, m_Channel: 0 }],
    ['scale', { m_Id: 1, m_SlotType: 0, m_Value: 4 }],
  ]);
  const parse = () =>
    compileWeightExpression(
      { node: 'noise', inputSlot: 0, outputSlot: 2 },
      byId,
      new Map(),
      new Map(),
      () => {
        throw new Error('unexpected texture');
      },
      new Set(),
    );
  expect(parse()).toEqual({ noise: { uv: 0, scale: 4 } });
  byId.get('noise')!.m_SGVersion = 1;
  expect(parse).toThrow('unsupported Unity scalar node');
});

it('selects a Boolean branch within scalar arithmetic', () => {
  const nodes = new Map<string, Record<string, unknown>>([
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
    ['yes', { m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: 0.8 }],
    ['no', { m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: 0.2 }],
  ]);
  const edges = new Map([
    [
      'branch',
      [
        { node: 'selector', inputSlot: 0, outputSlot: 0 },
        { node: 'yes', inputSlot: 1, outputSlot: 0 },
        { node: 'no', inputSlot: 2, outputSlot: 0 },
      ],
    ],
  ]);
  const parse = (value: number) =>
    compileWeightExpression(
      { node: 'branch', inputSlot: 0, outputSlot: 3 },
      nodes,
      edges,
      new Map([['_Switch', value]]),
      () => {
        throw new Error('unexpected texture');
      },
      new Set(),
    );
  expect(parse(0)).toBe(0.2);
  expect(parse(1)).toBe(0.8);
});
