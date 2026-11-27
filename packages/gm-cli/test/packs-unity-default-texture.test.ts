import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';
import { materialTextureProperties, parseUnitySurface } from '../src/packs/unity/material.js';

it('uses an explicitly unassigned white texture as a constant adjustment amount', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const docs = [
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [
        edge('power', 'base', 0, 2),
        edge('saturation', 'power', 0, 2),
        edge('mask', 'power', 1, 6),
        edge('multiply', 'saturation', 0, 2),
        edge('sample', 'multiply', 0),
        edge('mask', 'multiply', 1, 5),
        edge('invert', 'saturation', 1, 1),
        edge('mask', 'invert', 0, 4),
      ],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'power', m_Type: 'UnityEditor.ShaderGraph.PowerNode' },
    { m_ObjectId: 'saturation', m_Type: 'UnityEditor.ShaderGraph.SaturationNode' },
    { m_ObjectId: 'invert', m_Type: 'UnityEditor.ShaderGraph.OneMinusNode' },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    {
      m_ObjectId: 'mask',
      m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode',
      m_TextureType: 0,
      m_Slots: [{ m_Id: 'mask-slot' }],
    },
    {
      m_ObjectId: 'mask-slot',
      m_Type: 'UnityEditor.ShaderGraph.Texture2DInputMaterialSlot',
      m_Id: 1,
      m_SlotType: 0,
      m_DefaultType: 0,
      m_Texture: { m_SerializedTexture: '{"texture":{"instanceID":0}}', m_Guid: '' },
    },
    { m_ObjectId: 'multiply', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' },
  ];
  const source = () => docs.map((doc) => JSON.stringify(doc)).join('\n');
  const material = `--- !u!21 &1
Material:
  m_SavedProperties:
    m_TexEnvs:
    - _SampleTexture2D_sample_Texture_1: {m_Texture: {guid: aaaaaa}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}
    - _SampleTexture2D_mask_Texture_1: {m_Texture: {fileID: 0}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}
`;
  const resolve = (text: string) => shaderGraphBase(source(), new Map(), new Map(), materialTextureProperties(text));
  const surface = parseUnitySurface(material, resolve(material));
  expect(surface).toMatchObject({
    adjustment: { op: 'power', amount: 1 },
    products: [{ adjustment: { op: 'saturation', amount: 0 } }],
  });
  expect(() => resolve(material.replace('m_Texture: {fileID: 0}', 'm_Texture: {guid: bbbbbb}'))).toThrow(
    'unsupported Unity color adjustment amount',
  );
  expect(() => resolve(material.replace(/    - _SampleTexture2D_mask_Texture_1:.*\n/, ''))).toThrow(
    'unsupported Unity color adjustment amount',
  );
  expect(() => shaderGraphBase(source())).toThrow('unsupported Unity color adjustment amount');
  docs[7]!.m_Texture = { m_SerializedTexture: '{"texture":{"fileID":2800000,"guid":"abcdef"}}', m_Guid: 'abcdef' };
  expect(() => resolve(material)).toThrow('unsupported Unity color adjustment amount');
  docs[7]!.m_Texture = { m_SerializedTexture: '{"texture":{"instanceID":0}}', m_Guid: '' };
  docs[7]!.m_DefaultType = 1;
  expect(() => resolve(material)).toThrow('unsupported Unity color adjustment amount');
});
