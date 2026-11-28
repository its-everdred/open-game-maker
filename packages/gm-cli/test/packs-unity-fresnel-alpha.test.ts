import { expect, it } from 'vitest';
import { fresnelFrontAlpha } from '../src/packs/unity/fresnel-alpha.js';

it('approximates only the supported view-dependent opacity graph', () => {
  const edge = (from: string, to: string, input: number, output: number) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const graph = {
    m_Type: 'UnityEditor.ShaderGraph.GraphData',
    m_Edges: [
      edge('lerp', 'alpha', 0, 3),
      edge('front', 'lerp', 0, 0),
      edge('side', 'lerp', 1, 0),
      edge('fresnel', 'lerp', 2, 3),
      edge('power', 'fresnel', 2, 0),
    ],
  };
  const docs = [
    graph,
    { m_ObjectId: 'alpha', m_SerializedDescriptor: 'SurfaceDescription.Alpha' },
    { m_ObjectId: 'lerp', m_Type: 'UnityEditor.ShaderGraph.LerpNode' },
    { m_ObjectId: 'fresnel', m_Type: 'UnityEditor.ShaderGraph.FresnelNode' },
    { m_ObjectId: 'power', m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Slots: [{ m_Id: 'slot' }] },
    { m_ObjectId: 'slot', m_Id: 1, m_SlotType: 0, m_Value: 1 },
    { m_ObjectId: 'front', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'frontProp' } },
    { m_ObjectId: 'side', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'sideProp' } },
    {
      m_ObjectId: 'frontProp',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
      m_DefaultReferenceName: '_Front',
      m_Value: 0.1,
    },
    {
      m_ObjectId: 'sideProp',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
      m_DefaultReferenceName: '_Side',
      m_Value: 0.9,
    },
  ];
  const source = () => docs.map((doc) => JSON.stringify(doc)).join('\n');
  expect(fresnelFrontAlpha(source(), new Map([['_Front', 0.4]]))).toEqual({
    textures: [],
    factors: [{ kind: 'constant', key: '', defaultValue: 0.4 }],
  });
  graph.m_Edges.push(edge('front', 'fresnel', 0, 0));
  expect(fresnelFrontAlpha(source(), new Map())).toBeUndefined();
});
