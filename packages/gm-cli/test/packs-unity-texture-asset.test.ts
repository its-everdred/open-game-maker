import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';
import { parseUnitySurface } from '../src/packs/unity/material.js';

it('resolves an embedded texture asset GUID and rejects invalid references', () => {
  const edge = (from: string, to: string, input: number) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: 0 },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const asset = {
    m_ObjectId: 'asset',
    m_Type: 'UnityEditor.ShaderGraph.Texture2DAssetNode',
    m_Texture: { m_SerializedTexture: JSON.stringify({ texture: { fileID: 2800000, guid: 'a'.repeat(32) } }) },
  };
  const docs = [
    { m_Type: 'UnityEditor.ShaderGraph.GraphData', m_Edges: [edge('sample', 'base', 0), edge('asset', 'sample', 1)] },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    asset,
  ];
  const graph = () => shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n'));
  const material = '--- !u!21 &1\nMaterial:\n  m_SavedProperties: {}\n';
  expect(parseUnitySurface(material, graph()).textures).toEqual([
    { guid: 'a'.repeat(32), scale: [1, 1], offset: [0, 0] },
  ]);
  asset.m_Texture.m_SerializedTexture = '{"texture":{"fileID":0}}';
  expect(graph).toThrow('invalid Unity texture asset reference');
});
