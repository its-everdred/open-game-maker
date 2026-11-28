import { expect, it } from 'vitest';
import { shaderGraphAlpha, shaderGraphClipThreshold } from '../src/packs/unity/shader-alpha.js';
import { parseUnitySurface } from '../src/packs/unity/material.js';

it('resolves only a direct sampled alpha for a transparent surface', () => {
  const edge = (from: string, to: string, output: number) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: 0 },
  });
  const docs = [
    { m_Type: 'UnityEditor.ShaderGraph.GraphData', m_Edges: [edge('sample', 'alpha', 7), edge('sample', 'base', 0)] },
    {
      m_ObjectId: 'alpha',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.Alpha',
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
  ];
  const parse = () =>
    shaderGraphAlpha(docs.map((doc) => JSON.stringify(doc)).join('\n'), () => '', new Map(), new Map(), new Map());
  expect(parse()).toMatchObject({
    scalarMask: { channel: 3, term: { textures: ['_SampleTexture2D_sample_Texture_1'] } },
  });
  const material = `--- !u!21 &1
Material:
  stringTagMap: {RenderType: Transparent}
  m_SavedProperties:
    m_Floats:
    - _SurfaceType: 1
    - _BlendMode: 0
    - _SrcBlend: 1
    - _DstBlend: 10
    - _DoubleSidedEnable: 1
    - _AlphaClip: 0
    m_TexEnvs:
    - _SampleTexture2D_sample_Texture_1: {m_Texture: {guid: abcdef}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}
`;
  expect(parseUnitySurface(material, { textures: [], factors: [] }, parse())).toMatchObject({
    doubleSided: true,
    opacity: { scalarMask: { channel: 3, term: { textures: [{ guid: 'abcdef' }] } } },
  });
  const clipped = material.replace('_AlphaClip: 0', '_AlphaClip: 1\n    - _AlphaCutoffEnable: 1');
  expect(parseUnitySurface(clipped, { textures: [], factors: [] }, parse(), 0.5)).toMatchObject({ alphaCutoff: 0.5 });
  expect(() => parseUnitySurface(clipped, { textures: [], factors: [] }, parse())).toThrow('alpha-clipped');
  const additive = clipped.replace('_BlendMode: 0', '_BlendMode: 1').replace('_DstBlend: 10', '_DstBlend: 1');
  expect(parseUnitySurface(additive, { textures: [], factors: [] }, parse(), 0.5)).toMatchObject({
    additiveEmission: true,
    alphaCutoff: 0.5,
  });
  expect(() => parseUnitySurface(material.replace('_BlendMode: 0', '_BlendMode: 1'), undefined, parse())).toThrow(
    'unsupported transparent',
  );
  docs[0]!.m_Edges![0]!.m_OutputSlot.m_SlotId = 4;
  expect(parse).toThrow('unsupported Unity opacity graph');
});

it('reads only an unconnected constant alpha clip threshold', () => {
  const docs = [
    { m_Type: 'UnityEditor.ShaderGraph.GraphData', m_Edges: [] as unknown[] },
    {
      m_ObjectId: 'clip',
      m_SerializedDescriptor: 'SurfaceDescription.AlphaClipThreshold',
      m_Slots: [{ m_Id: 'slot' }],
    },
    { m_ObjectId: 'slot', m_Type: 'UnityEditor.ShaderGraph.Vector1MaterialSlot', m_Id: 0, m_SlotType: 0, m_Value: 0.5 },
  ];
  const source = () => docs.map((doc) => JSON.stringify(doc)).join('\n');
  expect(shaderGraphClipThreshold(source())).toBe(0.5);
  docs[0]!.m_Edges!.push({ m_InputSlot: { m_Node: { m_Id: 'clip' } } });
  expect(() => shaderGraphClipThreshold(source())).toThrow('unsupported Unity alpha clip threshold');
});

it('resolves sampled opacity multiplied by a nonnegative property', () => {
  const edge = (from: string, to: string, input: number, output: number) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [edge('multiply', 'alpha', 0, 2), edge('sample', 'multiply', 0, 7), edge('value', 'multiply', 1, 0)],
    },
    {
      m_ObjectId: 'alpha',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.Alpha',
    },
    { m_ObjectId: 'multiply', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'value', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
    {
      m_ObjectId: 'property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
      m_DefaultReferenceName: '_Opacity',
      m_Value: 1,
    },
  ];
  const parse = (opacity: number) =>
    shaderGraphAlpha(
      docs.map((doc) => JSON.stringify(doc)).join('\n'),
      () => '',
      new Map([['_Opacity', opacity]]),
      new Map(),
      new Map(),
    );
  expect(parse(1)).toMatchObject({
    scalarMask: { channel: 3, term: { textures: ['_SampleTexture2D_sample_Texture_1'] } },
  });
  expect(parse(0.5).factors).toEqual([{ kind: 'constant', key: '', defaultValue: 0.5 }]);
  docs[0]!.m_Edges![1]!.m_OutputSlot.m_SlotId = 0;
  expect(parse(6)).toMatchObject({ factors: [{ defaultValue: 6 }], scalarMask: { channel: 0 } });
  expect(() => parse(-1)).toThrow('unsupported Unity opacity graph');
});

it('selects material-specific opacity texture branches before resolving UVs', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [
        edge('multiply', 'alpha', 0, 2),
        edge('branch', 'multiply', 0, 3),
        edge('gain', 'multiply', 1),
        edge('flag', 'branch', 0),
        edge('a', 'branch', 1, 7),
        edge('b', 'branch', 2),
      ],
    },
    {
      m_ObjectId: 'alpha',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.Alpha',
    },
    { m_ObjectId: 'multiply', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' },
    { m_ObjectId: 'branch', m_Type: 'UnityEditor.ShaderGraph.BranchNode' },
    { m_ObjectId: 'a', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'b', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'gain', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'gain-property' } },
    {
      m_ObjectId: 'gain-property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
      m_DefaultReferenceName: '_Gain',
      m_Value: 1,
    },
    { m_ObjectId: 'flag', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'flag-property' } },
    {
      m_ObjectId: 'flag-property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.BooleanShaderProperty',
      m_DefaultReferenceName: '_Flag',
      m_Value: false,
    },
  ];
  const parse = (value: number) =>
    shaderGraphAlpha(
      docs.map((doc) => JSON.stringify(doc)).join('\n'),
      () => '',
      new Map([['_Flag', value]]),
      new Map(),
      new Map(),
    );
  expect(parse(0)).toMatchObject({ scalarMask: { channel: 0, term: { textures: ['_SampleTexture2D_b_Texture_1'] } } });
  expect(parse(1)).toMatchObject({ scalarMask: { channel: 3, term: { textures: ['_SampleTexture2D_a_Texture_1'] } } });
  expect(() => parse(2)).toThrow('unsupported Unity opacity graph');
});
