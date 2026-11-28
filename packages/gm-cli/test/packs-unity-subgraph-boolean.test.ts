import { expect, it } from 'vitest';
import { inlineUnitySubgraphs } from '../src/packs/unity/subgraphs.js';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';

it('uses an unconnected Boolean subgraph input to select its UV branch', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const child = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [
        edge('branch', 'output', 0, 3),
        edge('bool', 'branch', 0),
        edge('uv1', 'branch', 1),
        edge('uv0', 'branch', 2),
      ],
    },
    { m_ObjectId: 'output', m_Type: 'UnityEditor.ShaderGraph.SubGraphOutputNode', m_Slots: [{ m_Id: 'out-slot' }] },
    { m_ObjectId: 'out-slot', m_Type: 'UnityEditor.ShaderGraph.Vector2MaterialSlot', m_Id: 0, m_SlotType: 0 },
    { m_ObjectId: 'branch', m_Type: 'UnityEditor.ShaderGraph.BranchNode' },
    { m_ObjectId: 'bool', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
    {
      m_ObjectId: 'property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.BooleanShaderProperty',
      m_Guid: { m_GuidSerialized: 'bool-guid' },
    },
    { m_ObjectId: 'uv0', m_Type: 'UnityEditor.ShaderGraph.UVNode', m_OutputChannel: 0 },
    { m_ObjectId: 'uv1', m_Type: 'UnityEditor.ShaderGraph.UVNode', m_OutputChannel: 1 },
  ];
  const docs = [
    { m_Type: 'UnityEditor.ShaderGraph.GraphData', m_Edges: [edge('sample', 'base', 0), edge('sub', 'sample', 2)] },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    {
      m_ObjectId: 'sub',
      m_Type: 'UnityEditor.ShaderGraph.SubGraphNode',
      m_SerializedSubGraph: JSON.stringify({ subGraph: { guid: 'a'.repeat(32) } }),
      m_PropertyGuids: ['bool-guid'],
      m_PropertyIds: [11],
      m_Slots: [{ m_Id: 'default' }],
    },
    {
      m_ObjectId: 'default',
      m_Type: 'UnityEditor.ShaderGraph.BooleanMaterialSlot',
      m_Id: 11,
      m_SlotType: 0,
      m_Value: false,
    },
  ];
  const source = (items: object[]) => items.map((doc) => JSON.stringify(doc)).join('\n');
  const parse = () => shaderGraphBase(inlineUnitySubgraphs(source(docs), () => source(child)));
  expect(parse().textureUvTransforms?.[0]?.channel).toBe(0);
  docs[4]!.m_Value = true;
  expect(parse().textureUvTransforms?.[0]?.channel).toBe(1);
});
