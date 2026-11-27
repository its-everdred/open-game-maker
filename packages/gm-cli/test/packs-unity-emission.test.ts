import { expect, it } from 'vitest';
import { shaderGraphEmission } from '../src/packs/unity/shader-emission.js';

it('resolves the connected emission graph independently of base color', () => {
  const edge = (from: string, to: string, input: number, output: number) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [edge('sample', 'emit', 0, 0), edge('unsupported', 'base', 0, 0)],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    {
      m_ObjectId: 'emit',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.Emission',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'unsupported', m_Type: 'UnityEditor.ShaderGraph.UnsupportedNode' },
  ];
  const parse = () =>
    shaderGraphEmission(docs.map((doc) => JSON.stringify(doc)).join('\n'), () => '', new Map(), new Map(), new Map());
  expect(parse().textures).toEqual(['_SampleTexture2D_sample_Texture_1']);
  docs[2]!.m_SerializedDescriptor = 'SurfaceDescription.Other';
  expect(parse).toThrow('missing Unity emission graph');
});
