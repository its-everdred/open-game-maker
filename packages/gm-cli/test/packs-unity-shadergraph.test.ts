import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';

it('follows texture multiplication into base color and rejects unknown graph nodes', () => {
  const edge = (from: string, to: string, inputSlot = 0, outputSlot = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: outputSlot },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: inputSlot },
  });
  const graph = {
    m_Type: 'UnityEditor.ShaderGraph.GraphData',
    m_Edges: [edge('mix', 'base', 0, 2), edge('a', 'mix'), edge('b', 'mix', 1)],
  };
  const docs = [
    graph,
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'mix', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' },
    ...['a', 'b'].map((id) => ({ m_ObjectId: id, m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' })),
  ];
  const source = docs.map((value) => JSON.stringify(value)).join('\n');
  expect(shaderGraphBase(source).textures).toEqual(['_SampleTexture2D_a_Texture_1', '_SampleTexture2D_b_Texture_1']);
  expect(() => shaderGraphBase(source.replace('MultiplyNode', 'AddNode'))).toThrow('unsupported Unity shader graph');
});

it('resolves scalar and color property terms from a graph', async () => {
  const { parseUnitySurface } = await import('../src/packs/unity/material.js');
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [edge('mix', 'base', 0, 2), edge('colorNode', 'mix', 0), edge('scalarNode', 'mix', 1)],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'mix', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' },
    { m_ObjectId: 'colorNode', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'color' } },
    { m_ObjectId: 'scalarNode', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'scalar' } },
    {
      m_ObjectId: 'color',
      m_Type: 'UnityEditor.ShaderGraph.Internal.ColorShaderProperty',
      m_DefaultReferenceName: 'Tint',
      m_Value: { r: 1, g: 1, b: 1, a: 1 },
    },
    {
      m_ObjectId: 'scalar',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
      m_DefaultReferenceName: 'Strength',
      m_Value: 1,
    },
  ];
  const graph = shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n'));
  const material = `--- !u!21 &1
Material:
  m_SavedProperties:
    m_Floats:
    - Strength: 0.5
    m_Colors:
    - Tint: {r: 1, g: 0.5, b: 0.25, a: 1}
`;
  expect(parseUnitySurface(material, graph)).toEqual({ textures: [], color: [0.5, 0.25, 0.125, 0.5] });
});

it('resolves an explicit texture property with the default UV channel', () => {
  const edge = (from: string, to: string, input: number) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: 0 },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [edge('sample', 'base', 0), edge('property', 'sample', 1), edge('uv', 'sample', 2)],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'property', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'texture' } },
    {
      m_ObjectId: 'texture',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Texture2DShaderProperty',
      m_DefaultReferenceName: 'BaseTexture',
    },
    { m_ObjectId: 'uv', m_Type: 'UnityEditor.ShaderGraph.UVNode', m_OutputChannel: 0 },
  ];
  const source = docs.map((doc) => JSON.stringify(doc)).join('\n');
  expect(shaderGraphBase(source).textures).toEqual(['BaseTexture']);
  expect(() => shaderGraphBase(source.replace('"m_OutputChannel":0', '"m_OutputChannel":1'))).toThrow(
    'unsupported Unity texture UV graph',
  );
});

it('selects the material boolean branch without interpreting its inactive branch', async () => {
  const { materialFloatProperties } = await import('../src/packs/unity/material.js');
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [
        edge('branch', 'base', 0, 3),
        edge('switch', 'branch', 0),
        edge('texture', 'branch', 1),
        edge('unsupported', 'branch', 2),
      ],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'branch', m_Type: 'UnityEditor.ShaderGraph.BranchNode' },
    { m_ObjectId: 'switch', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'boolean' } },
    {
      m_ObjectId: 'boolean',
      m_Type: 'UnityEditor.ShaderGraph.Internal.BooleanShaderProperty',
      m_DefaultReferenceName: '_Switch',
      m_Value: false,
    },
    { m_ObjectId: 'texture', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'unsupported', m_Type: 'UnityEditor.ShaderGraph.NoiseNode' },
  ];
  const source = docs.map((doc) => JSON.stringify(doc)).join('\n');
  const material = '--- !u!21 &1\nMaterial:\n  m_SavedProperties:\n    m_Floats:\n    - _Switch: 1\n';
  expect(shaderGraphBase(source, materialFloatProperties(material)).textures).toEqual([
    '_SampleTexture2D_texture_Texture_1',
  ]);
  expect(() => shaderGraphBase(source)).toThrow('unsupported Unity shader graph');
  const supported = source.replace('UnityEditor.ShaderGraph.NoiseNode', 'UnityEditor.ShaderGraph.SampleTexture2DNode');
  expect(shaderGraphBase(supported).textures).toEqual(['_SampleTexture2D_unsupported_Texture_1']);
  expect(() => shaderGraphBase(source, new Map([['_Switch', '0.5']]))).toThrow(
    'invalid Unity shader graph branch value',
  );
});
