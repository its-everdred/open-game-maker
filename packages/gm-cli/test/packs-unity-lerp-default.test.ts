import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';

it('selects a connected branch only for an exact uniform default interpolation', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [edge('lerp', 'base', 0, 3), edge('a', 'lerp', 0), edge('b', 'lerp', 1)],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'lerp', m_Type: 'UnityEditor.ShaderGraph.LerpNode', m_Slots: [{ m_Id: 'amount' }] },
    { m_ObjectId: 'a', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'b', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    {
      m_ObjectId: 'amount',
      m_Type: 'UnityEditor.ShaderGraph.DynamicVectorMaterialSlot',
      m_Id: 2,
      m_SlotType: 0,
      m_Value: { x: 0, y: 0, z: 0, w: 0 },
    },
  ];
  const parse = () => shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n'));
  expect(parse().textures).toEqual(['_SampleTexture2D_a_Texture_1']);
  docs[5]!.m_Value = { x: 1, y: 1, z: 1, w: 1 };
  expect(parse().textures).toEqual(['_SampleTexture2D_b_Texture_1']);
  docs[5]!.m_Value = { x: 0, y: 1, z: 0, w: 0 };
  expect(parse).toThrow('unsupported Unity shader graph interpolation');
});
