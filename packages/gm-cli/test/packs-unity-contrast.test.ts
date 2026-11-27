import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';

it('folds unit contrast from a proven endpoint of an HDR color property', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [
        edge('contrast', 'base', 0, 2),
        edge('sample', 'contrast', 0),
        edge('split', 'contrast', 1, 3),
        edge('value', 'split', 0),
      ],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'contrast', m_Type: 'UnityEditor.ShaderGraph.ContrastNode' },
    { m_ObjectId: 'split', m_Type: 'UnityEditor.ShaderGraph.SplitNode' },
    { m_ObjectId: 'value', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
    {
      m_ObjectId: 'property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.ColorShaderProperty',
      m_SGVersion: 3,
      m_DefaultReferenceName: '_Adjust',
      m_ColorMode: 1,
      m_Value: { r: 1, g: 1, b: 0, a: 1 },
    },
  ];
  const parse = (b: number) =>
    shaderGraphBase(
      docs.map((doc) => JSON.stringify(doc)).join('\n'),
      new Map(),
      new Map([['_Adjust', { r: 0.4, g: 0.5, b, a: 1 }]]),
    );
  expect(parse(1).textures).toEqual(['_SampleTexture2D_sample_Texture_1']);
  expect(() => parse(0.8)).toThrow('unsupported Unity color contrast');
  expect(() => parse(0)).toThrow('unsupported Unity color contrast');
  docs[3]!.m_Type = 'UnityEditor.ShaderGraph.SaturationNode';
  docs[0]!.m_Edges![2]!.m_OutputSlot = { m_Node: { m_Id: 'inverse' }, m_SlotId: 1 };
  docs[0]!.m_Edges!.push(edge('split', 'inverse', 0, 3));
  docs.push({ m_ObjectId: 'inverse', m_Type: 'UnityEditor.ShaderGraph.OneMinusNode' } as (typeof docs)[number]);
  expect(parse(0.8).adjustment?.amount.defaultValue).toBeCloseTo(0.2);
  docs[6]!.m_SGVersion = 2;
  expect(() => parse(0.8)).toThrow('unsupported Unity color adjustment property');
});
