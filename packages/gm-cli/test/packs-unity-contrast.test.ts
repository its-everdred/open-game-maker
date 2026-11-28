import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';
import { parseUnitySurface } from '../src/packs/unity/material.js';
import { createScalarFactor } from '../src/packs/unity/color-factor.js';

it('resolves contrast and saturation from supported HDR and vector properties', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [
        edge('contrast', 'base', 0, 2),
        edge('sample', 'contrast', 0),
        edge('split', 'contrast', 1, 3),
        edge('value', 'split', 0),
      ],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'contrast', m_Type: 'UnityEditor.ShaderGraph.ContrastNode' },
    { m_ObjectId: 'split', m_Type: 'UnityEditor.ShaderGraph.SplitNode' },
    { m_ObjectId: 'value', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
    {
      m_ObjectId: 'property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.ColorShaderProperty',
      m_SGVersion: 3,
      m_DefaultReferenceName: '_Adjust',
      m_ColorMode: 1,
      m_Value: { r: 1, g: 1, b: 0, a: 1 },
    },
  ];
  const parse = (b: number) =>
    shaderGraphBase(
      docs.map((doc) => JSON.stringify(doc)).join('\n'),
      new Map(),
      new Map([['_Adjust', { r: 0.4, g: 0.5, b, a: 1 }]]),
    );
  expect(parse(1).products?.[0]?.textures).toEqual(['_SampleTexture2D_sample_Texture_1']);
  expect(parse(0.8).adjustment?.amount.defaultValue).toBe(0.8);
  expect(parse(0).adjustment?.amount.defaultValue).toBe(0);
  const material =
    '--- !u!21 &1\nMaterial:\n  m_SavedProperties:\n    m_TexEnvs:\n    - _SampleTexture2D_sample_Texture_1: {m_Texture: {guid: abcdef}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}\n';
  expect(() =>
    parseUnitySurface(material, {
      textures: [],
      factors: [],
      products: [parse(2)],
      adjustment: { op: 'power', amount: { key: '', kind: 'constant', defaultValue: 2 } },
    }),
  ).toThrow('unsupported Unity power input');
  docs[3]!.m_Type = 'UnityEditor.ShaderGraph.SaturationNode';
  docs[0]!.m_Edges![2]!.m_OutputSlot = { m_Node: { m_Id: 'inverse' }, m_SlotId: 1 };
  docs[0]!.m_Edges!.push(edge('split', 'inverse', 0, 3));
  docs.push({ m_ObjectId: 'inverse', m_Type: 'UnityEditor.ShaderGraph.OneMinusNode' } as (typeof docs)[number]);
  expect(parse(0.8).adjustment?.amount.defaultValue).toBeCloseTo(0.2);
  docs[6]!.m_SGVersion = 2;
  expect(() => parse(0.8)).toThrow('unsupported Unity color adjustment property');
  Object.assign(docs[6]!, {
    m_Type: 'UnityEditor.ShaderGraph.Internal.Vector3ShaderProperty',
    m_Value: { x: 1, y: 1, z: 1 },
  });
  expect(parse(0.8).adjustment?.amount.defaultValue).toBeCloseTo(0.2);
  docs[0]!.m_Edges![3]!.m_OutputSlot.m_SlotId = 0;
  docs[0]!.m_Edges![4]!.m_OutputSlot.m_SlotId = 4;
  expect(parse(0.8).adjustment?.amount.defaultValue).toBe(0);
});

it('uses the material scalar override when inverting an adjustment amount', () => {
  const nodes = new Map<string, Record<string, unknown>>([
    ['inverse', { m_Type: 'UnityEditor.ShaderGraph.OneMinusNode' }],
    ['value', { m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } }],
    [
      'property',
      {
        m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
        m_DefaultReferenceName: '_Amount',
        m_Value: 0.8,
      },
    ],
  ]);
  const edges = new Map([['inverse', [{ node: 'value', inputSlot: 0, outputSlot: 0 }]]]);
  const resolve = createScalarFactor(nodes, edges, new Map([['_Amount', 0.25]]), new Map());
  expect(resolve({ node: 'inverse', outputSlot: 1 }).defaultValue).toBe(0.75);
});

it('resolves color Overlay blends using RGB texture inputs and the saved opacity', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [edge('blend', 'base', 0, 2), edge('first', 'blend', 0), edge('second', 'blend', 1)],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    {
      m_ObjectId: 'blend',
      m_Type: 'UnityEditor.ShaderGraph.BlendNode',
      m_BlendMode: 15,
      m_Slots: [{ m_Id: 'opacity' }],
    },
    { m_ObjectId: 'opacity', m_Id: 3, m_SlotType: 0, m_Value: 0.5 },
    { m_ObjectId: 'first', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'second', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
  ];
  const graph = shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n'));
  expect(JSON.stringify(graph.scalarMask)).toContain('"op":"overlay"');
  const mat =
    '--- !u!21 &1\nMaterial:\n  m_SavedProperties:\n    m_TexEnvs:\n    - _SampleTexture2D_first_Texture_1: {m_Texture: {guid: aaaa}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}\n    - _SampleTexture2D_second_Texture_1: {m_Texture: {guid: bbbb}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}\n';
  expect(parseUnitySurface(mat, graph).scalarMask).toBeDefined();
  docs[2]!.m_BlendMode = 0;
  expect(() => shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n'))).toThrow(
    'unsupported Unity color blend',
  );
});
