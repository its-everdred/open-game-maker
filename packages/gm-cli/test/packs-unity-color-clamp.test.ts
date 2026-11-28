import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';

it('preserves RGB clamp applied before a color blend', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [
        edge('blend', 'base', 0, 2),
        edge('clamp', 'blend', 0, 3),
        edge('sample', 'blend', 1),
        edge('sample', 'clamp', 0),
      ],
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
    { m_ObjectId: 'clamp', m_Type: 'UnityEditor.ShaderGraph.ClampNode', m_Slots: [{ m_Id: 'lo' }, { m_Id: 'hi' }] },
    { m_ObjectId: 'lo', m_Id: 1, m_SlotType: 0, m_Value: 0 },
    { m_ObjectId: 'hi', m_Id: 2, m_SlotType: 0, m_Value: 1 },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
  ];
  expect(JSON.stringify(shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n')).scalarMask)).toContain(
    '"op":"clamp"',
  );
  docs[0]!.m_Edges![3]!.m_OutputSlot.m_Node.m_Id = 'color';
  docs.push({
    m_ObjectId: 'color',
    m_Type: 'UnityEditor.ShaderGraph.PropertyNode',
    m_Property: { m_Id: 'property' },
  } as (typeof docs)[number]);
  docs.push({
    m_ObjectId: 'property',
    m_Type: 'UnityEditor.ShaderGraph.Internal.ColorShaderProperty',
    m_DefaultReferenceName: '_Color',
    m_Value: { r: 1, g: 0.5, b: 0.25, a: 1 },
  } as (typeof docs)[number]);
  expect(JSON.stringify(shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n')).scalarMask)).toContain(
    '"key":"_Color"',
  );
  docs[4]!.m_Type = 'UnityEditor.ShaderGraph.AddNode';
  docs[0]!.m_Edges![1]!.m_OutputSlot.m_SlotId = 2;
  docs[0]!.m_Edges!.push(edge('sample', 'clamp', 1));
  expect(JSON.stringify(shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n')).scalarMask)).toContain(
    '"op":"add"',
  );
});
