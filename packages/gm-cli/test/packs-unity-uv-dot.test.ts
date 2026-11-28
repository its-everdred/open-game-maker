import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';

it('resolves affine UV dot products and rejects nonlinear ones', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const graph = {
    m_Type: 'UnityEditor.ShaderGraph.GraphData',
    m_Edges: [
      edge('tex', 'base', 0),
      edge('combine', 'tex', 2, 6),
      edge('dot', 'combine', 0, 2),
      edge('one', 'combine', 1),
      edge('uv', 'dot', 0),
      edge('vector', 'dot', 1),
    ],
  };
  const docs = [
    graph,
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'tex', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'combine', m_Type: 'UnityEditor.ShaderGraph.CombineNode' },
    { m_ObjectId: 'dot', m_Type: 'UnityEditor.ShaderGraph.DotProductNode' },
    { m_ObjectId: 'one', m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: 1 },
    { m_ObjectId: 'uv', m_Type: 'UnityEditor.ShaderGraph.UVNode' },
    { m_ObjectId: 'vector', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
    {
      m_ObjectId: 'property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector2ShaderProperty',
      m_DefaultReferenceName: '_Direction',
      m_Value: { x: 2, y: 3 },
    },
  ];
  const parse = () => shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n'));
  expect(parse().textureUvTransforms).toEqual([{ channel: 0, matrix: [2, 3, 0, 0, 0, 1] }]);
  graph.m_Edges[5]!.m_OutputSlot.m_Node.m_Id = 'uv';
  expect(parse).toThrow('nonlinear Unity UV graph');
  graph.m_Edges[5]!.m_OutputSlot.m_Node.m_Id = 'vector';
  docs.push(
    {
      m_ObjectId: 'cos',
      m_Type: 'UnityEditor.ShaderGraph.CosineNode',
      m_Slots: [{ m_Id: 'angle' }],
    } as (typeof docs)[number],
    {
      m_ObjectId: 'angle',
      m_Type: 'UnityEditor.ShaderGraph.DynamicVectorMaterialSlot',
      m_Id: 0,
      m_SlotType: 0,
      m_Value: { x: 0, y: 0, z: 0, w: 0 },
    } as (typeof docs)[number],
  );
  graph.m_Edges[3]!.m_OutputSlot = { m_Node: { m_Id: 'cos' }, m_SlotId: 1 };
  expect(parse().textureUvTransforms).toEqual([{ channel: 0, matrix: [2, 3, 0, 0, 0, 1] }]);
  graph.m_Edges.push(edge('uv', 'cos', 0));
  expect(parse).toThrow('nonlinear Unity UV graph');
});
