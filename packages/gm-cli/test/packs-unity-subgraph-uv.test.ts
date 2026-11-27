import { expect, it } from 'vitest';
import { inlineUnitySubgraphs } from '../src/packs/unity/subgraphs.js';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';

it('coerces a two-component subgraph binding only inside UV graphs', () => {
  const guid = 'a'.repeat(32);
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const child = [
    { m_Type: 'UnityEditor.ShaderGraph.GraphData', m_Edges: [edge('property-node', 'output', 0)] },
    { m_ObjectId: 'output', m_Type: 'UnityEditor.ShaderGraph.SubGraphOutputNode', m_Slots: [{ m_Id: 'output-slot' }] },
    { m_ObjectId: 'output-slot', m_Type: 'UnityEditor.ShaderGraph.Vector2MaterialSlot', m_Id: 0, m_SlotType: 0 },
    { m_ObjectId: 'property-node', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
    {
      m_ObjectId: 'property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector2ShaderProperty',
      m_Guid: { m_GuidSerialized: 'uv-guid' },
    },
  ];
  const graph = {
    m_Type: 'UnityEditor.ShaderGraph.GraphData',
    m_Edges: [edge('sample', 'base', 0), edge('sub', 'sample', 2), edge('uv', 'sub', 11)],
  };
  const docs = [
    graph,
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'uv', m_Type: 'UnityEditor.ShaderGraph.UVNode', m_OutputChannel: 1 },
    {
      m_ObjectId: 'sub',
      m_Type: 'UnityEditor.ShaderGraph.SubGraphNode',
      m_SerializedSubGraph: JSON.stringify({ subGraph: { guid } }),
      m_PropertyGuids: ['uv-guid'],
      m_PropertyIds: [11],
      m_Slots: [{ m_Id: 'default' }],
    },
    {
      m_ObjectId: 'default',
      m_Type: 'UnityEditor.ShaderGraph.Vector2MaterialSlot',
      m_Id: 11,
      m_SlotType: 0,
      m_Value: { x: 0.25, y: 0.75 },
    },
  ];
  const source = (items: object[]) => items.map((doc) => JSON.stringify(doc)).join('\n');
  const parse = () => shaderGraphBase(inlineUnitySubgraphs(source(docs), () => source(child)));
  expect(parse().textureUvTransforms).toEqual([{ channel: 1, matrix: [1, 0, 0, 0, 1, 0] }]);
  graph.m_Edges = graph.m_Edges.filter((item) => item.m_InputSlot.m_Node.m_Id !== 'sub');
  expect(parse().textureUvTransforms).toEqual([{ channel: 0, matrix: [0, 0, 0.25, 0, 0, 0.75] }]);
  graph.m_Edges.push(edge('scalar', 'sub', 11));
  docs.push({
    m_ObjectId: 'scalar',
    m_Type: 'UnityEditor.ShaderGraph.Vector1Node',
    m_Value: 0.5,
  } as (typeof docs)[number]);
  expect(parse().textureUvTransforms).toEqual([{ channel: 0, matrix: [0, 0, 0.5, 0, 0, 0.5] }]);
});
