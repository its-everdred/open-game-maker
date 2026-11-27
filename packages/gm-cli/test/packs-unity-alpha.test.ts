import { expect, it } from 'vitest';
import { shaderGraphAlpha } from '../src/packs/unity/shader-alpha.js';
import { parseUnitySurface } from '../src/packs/unity/material.js';

it('resolves only a direct sampled alpha for a transparent surface', () => {
  const edge = (from: string, to: string, output: number) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: 0 },
  });
  const docs = [
    { m_Type: 'UnityEditor.ShaderGraph.GraphData', m_Edges: [edge('sample', 'alpha', 7), edge('sample', 'base', 0)] },
    {
      m_ObjectId: 'alpha',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.Alpha',
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
  ];
  const parse = () =>
    shaderGraphAlpha(docs.map((doc) => JSON.stringify(doc)).join('\n'), () => '', new Map(), new Map(), new Map());
  expect(parse()).toMatchObject({
    scalarMask: { channel: 3, term: { textures: ['_SampleTexture2D_sample_Texture_1'] } },
  });
  const material = `--- !u!21 &1
Material:
  stringTagMap: {RenderType: Transparent}
  m_SavedProperties:
    m_Floats:
    - _SurfaceType: 1
    - _BlendMode: 0
    - _SrcBlend: 1
    - _DstBlend: 10
    - _DoubleSidedEnable: 1
    - _AlphaClip: 0
    m_TexEnvs:
    - _SampleTexture2D_sample_Texture_1: {m_Texture: {guid: abcdef}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}
`;
  expect(parseUnitySurface(material, { textures: [], factors: [] }, parse())).toMatchObject({
    doubleSided: true,
    opacity: { scalarMask: { channel: 3, term: { textures: [{ guid: 'abcdef' }] } } },
  });
  expect(() => parseUnitySurface(material.replace('_BlendMode: 0', '_BlendMode: 1'), undefined, parse())).toThrow(
    'unsupported transparent',
  );
  docs[0]!.m_Edges![0]!.m_OutputSlot.m_SlotId = 4;
  expect(parse).toThrow('unsupported Unity opacity graph');
});
