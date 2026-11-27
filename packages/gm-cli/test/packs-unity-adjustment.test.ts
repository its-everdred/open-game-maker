import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';
import { parseUnitySurface } from '../src/packs/unity/material.js';

it('preserves saturation, multiplication and power order with material component overrides', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [
        edge('power', 'base', 0, 2),
        edge('multiply', 'power', 0, 2),
        edge('split', 'power', 1, 3),
        edge('saturation', 'multiply', 0, 2),
        edge('split', 'multiply', 1, 2),
        edge('sample', 'saturation', 0),
        edge('split', 'saturation', 1, 1),
        edge('settings', 'split', 0),
      ],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'power', m_Type: 'UnityEditor.ShaderGraph.PowerNode' },
    { m_ObjectId: 'multiply', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' },
    { m_ObjectId: 'saturation', m_Type: 'UnityEditor.ShaderGraph.SaturationNode' },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'split', m_Type: 'UnityEditor.ShaderGraph.SplitNode' },
    { m_ObjectId: 'settings', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
    {
      m_ObjectId: 'property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.ColorShaderProperty',
      m_DefaultReferenceName: '_Settings',
      m_Value: { r: 1, g: 1, b: 1, a: 1 },
      m_ColorMode: 0,
    },
  ];
  const graph = shaderGraphBase(docs.map((item) => JSON.stringify(item)).join('\n'));
  const material = `--- !u!21 &1
Material:
  m_SavedProperties:
    m_Colors:
    - _Settings: {r: 0.5, g: 0.25, b: 2, a: 1}
    m_TexEnvs:
    - _SampleTexture2D_sample_Texture_1: {m_Texture: {guid: aaaaaa}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}
`;
  const surface = parseUnitySurface(material, graph);
  expect(surface).toMatchObject({
    adjustment: { op: 'power', amount: 2 },
    products: [
      {
        products: [
          { adjustment: { op: 'saturation', amount: 0.5 }, products: [{ textures: [{ guid: 'aaaaaa' }] }] },
          { color: [0.25, 0.25, 0.25, 0.25] },
        ],
      },
    ],
  });
  const bright = parseUnitySurface(material.replace('g: 0.25', 'g: 1.1'), graph);
  expect(bright.products?.[0]?.products?.[1]?.color).toEqual([1.1, 1.1, 1.1, 1.1]);
  expect(() => parseUnitySurface(material.replace('r: 0.5', 'r: 1.5'), graph)).toThrow(
    'unsupported Unity color adjustment amount',
  );
  expect(() => parseUnitySurface(material.replace('b: 2', 'b: -1'), graph)).toThrow(
    'unsupported Unity color adjustment amount',
  );
  expect(() => parseUnitySurface(material.replace('b: 2', 'b: 0'), graph)).toThrow(
    'unsupported Unity color adjustment amount',
  );
  expect(() =>
    parseUnitySurface(material, {
      textures: [],
      factors: [],
      products: [
        {
          textures: [],
          factors: [],
          blends: [{ a: { textures: [], factors: [] }, b: { textures: [], factors: [] }, weight: 0.5 }],
        },
      ],
      adjustment: { op: 'power', amount: { kind: 'constant', key: '', defaultValue: 2 } },
    }),
  ).toThrow('unsupported Unity power input with blends');
});
