import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';
import { parseUnitySurface } from '../src/packs/unity/material.js';

it('keeps a selected texture channel as a scalar multiplier', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [
        edge('multiply', 'base', 0, 2),
        edge('main', 'multiply', 0),
        edge('lerp', 'multiply', 1, 3),
        edge('mask', 'lerp', 1, 4),
        edge('amount', 'lerp', 2),
      ],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'multiply', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' },
    { m_ObjectId: 'lerp', m_Type: 'UnityEditor.ShaderGraph.LerpNode' },
    { m_ObjectId: 'main', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'mask', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode', m_TextureType: 0 },
    { m_ObjectId: 'amount', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
    {
      m_ObjectId: 'property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
      m_DefaultReferenceName: '_Weight',
      m_Value: 0.5,
    },
  ];
  const source = () => docs.map((doc) => JSON.stringify(doc)).join('\n');
  const material = `--- !u!21 &1
Material:
  m_SavedProperties:
    m_TexEnvs:
    - _SampleTexture2D_main_Texture_1: {m_Texture: {guid: aaaaaa}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}
    - _SampleTexture2D_mask_Texture_1: {m_Texture: {guid: bbbbbb}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}
`;
  const graph = shaderGraphBase(source(), new Map([['_Weight', 1]]));
  expect(parseUnitySurface(material, graph)).toMatchObject({
    products: [
      { textures: [{ guid: 'aaaaaa' }] },
      { scalarMask: { channel: 0, term: { textures: [{ guid: 'bbbbbb' }] } } },
    ],
  });
  expect(() => shaderGraphBase(source(), new Map([['_Weight', 0]]))).toThrow(
    'unsupported Unity shader graph interpolation input',
  );
  expect(() => shaderGraphBase(source())).toThrow('unsupported Unity shader graph interpolation input');
  docs[5]!.m_TextureType = 1;
  expect(() => shaderGraphBase(source(), new Map([['_Weight', 1]]))).toThrow('unsupported Unity texture sample type');
});
