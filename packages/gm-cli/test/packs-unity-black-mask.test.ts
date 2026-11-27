import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';
import { materialTextureProperties, parseUnitySurface } from '../src/packs/unity/material.js';

it('uses a null black texture property only for known RGB mask channels', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs: Record<string, unknown>[] = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [
        edge('lerp', 'base', 0, 3),
        edge('a', 'lerp', 0),
        edge('b', 'lerp', 1),
        edge('mask', 'lerp', 2, 4),
        edge('property-node', 'mask', 1),
      ],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'lerp', m_Type: 'UnityEditor.ShaderGraph.LerpNode', m_Slots: [{ m_Id: 'lerp-t' }] },
    { m_ObjectId: 'lerp-t', m_Id: 2, m_SlotType: 0, m_Type: 'UnityEditor.ShaderGraph.DynamicVectorMaterialSlot' },
    ...['a', 'b'].map((id) => ({ m_ObjectId: id, m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' })),
    { m_ObjectId: 'mask', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode', m_TextureType: 0 },
    { m_ObjectId: 'property-node', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
    {
      m_ObjectId: 'property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Texture2DShaderProperty',
      m_DefaultReferenceName: '_Mask',
      m_DefaultType: 1,
      m_Modifiable: true,
      m_GeneratePropertyBlock: true,
      m_Value: { m_SerializedTexture: '{"texture":{"fileID":2800000,"guid":"defaultasset"}}', m_Guid: '' },
    },
  ];
  const source = () => docs.map((doc) => JSON.stringify(doc)).join('\n');
  const material = `--- !u!21 &1
Material:
  m_SavedProperties:
    m_TexEnvs:
    - _SampleTexture2D_a_Texture_1: {m_Texture: {guid: aaaaaa}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}
    - _SampleTexture2D_b_Texture_1: {m_Texture: {guid: bbbbbb}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}
    - _Mask: {m_Texture: {fileID: 0}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}
`;
  const resolve = (text: string) => shaderGraphBase(source(), new Map(), new Map(), materialTextureProperties(text));
  expect(parseUnitySurface(material, resolve(material)).blends?.[0]?.weight).toMatchObject({
    term: { textures: [], color: [0, 0, 0, 1] },
    channel: 0,
  });
  const assigned = material.replace('m_Texture: {fileID: 0}', 'm_Texture: {guid: cccccc}');
  expect(parseUnitySurface(assigned, resolve(assigned)).blends?.[0]?.weight).toMatchObject({
    term: { textures: [{ guid: 'cccccc' }] },
    channel: 0,
  });
  docs.push({ m_ObjectId: 'multiply', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' });
  docs[0]!.m_Edges = [
    edge('multiply', 'base', 0, 2),
    edge('a', 'multiply', 0),
    edge('mask', 'multiply', 1, 5),
    edge('property-node', 'mask', 1),
  ];
  expect(parseUnitySurface(material, resolve(material))).toMatchObject({
    color: [0, 0, 0, 0],
    textures: [{ guid: 'aaaaaa' }],
  });
  expect(parseUnitySurface(assigned, resolve(assigned))).toMatchObject({
    products: [
      { textures: [{ guid: 'aaaaaa' }] },
      { scalarMask: { channel: 1, term: { textures: [{ guid: 'cccccc' }] } } },
    ],
  });
  docs[8]!.m_DefaultType = 0;
  expect(() => parseUnitySurface(material, resolve(material))).toThrow('missing Unity texture');
  docs[8]!.m_DefaultType = 1;
  docs[8]!.m_Modifiable = false;
  expect(() => parseUnitySurface(material, resolve(material))).toThrow('missing Unity texture');
  docs[8]!.m_Modifiable = true;
  docs[0]!.m_Edges = [
    edge('lerp', 'base', 0, 3),
    edge('a', 'lerp', 0),
    edge('b', 'lerp', 1),
    edge('contrast', 'lerp', 2, 2),
    edge('mask', 'contrast', 0),
    edge('one', 'contrast', 1),
    edge('property-node', 'mask', 1),
  ];
  docs.push(
    { m_ObjectId: 'contrast', m_Type: 'UnityEditor.ShaderGraph.ContrastNode', m_Slots: [{ m_Id: 'contrast-out' }] },
    { m_ObjectId: 'contrast-out', m_Id: 2, m_SlotType: 1, m_Type: 'UnityEditor.ShaderGraph.Vector3MaterialSlot' },
    { m_ObjectId: 'one', m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: 1 },
  );
  expect(parseUnitySurface(material, resolve(material)).blends?.[0]?.weight).toMatchObject({
    op: 'contrast',
    args: [{ term: { textures: [], color: [0, 0, 0, 1] }, channel: 'rgb' }, 1],
  });
  docs[0]!.m_Edges = [
    edge('lerp', 'base', 0, 3),
    edge('a', 'lerp', 0),
    edge('b', 'lerp', 1),
    edge('contrast', 'lerp', 2, 2),
    edge('mask', 'contrast', 0, 7),
    edge('one', 'contrast', 1),
    edge('property-node', 'mask', 1),
  ];
  expect(() => parseUnitySurface(material, resolve(material))).toThrow('missing Unity texture');
  docs[0]!.m_Edges = [
    edge('lerp', 'base', 0, 3),
    edge('a', 'lerp', 0),
    edge('b', 'lerp', 1),
    edge('mask', 'lerp', 2, 7),
    edge('property-node', 'mask', 1),
  ];
  expect(() => parseUnitySurface(material, resolve(material))).toThrow('missing Unity texture');
});
