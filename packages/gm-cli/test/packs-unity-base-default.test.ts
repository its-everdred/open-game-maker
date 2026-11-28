import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';
import { parseUnitySurface } from '../src/packs/unity/material.js';

it('preserves a valid unconnected base color and rejects HDR defaults', () => {
  const docs = [
    { m_Type: 'UnityEditor.ShaderGraph.GraphData', m_Edges: [] },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
      m_Slots: [{ m_Id: 'slot' }],
    },
    {
      m_ObjectId: 'slot',
      m_Type: 'UnityEditor.ShaderGraph.ColorRGBMaterialSlot',
      m_Id: 0,
      m_SlotType: 0,
      m_ColorMode: 0,
      m_Value: { x: 0.5, y: 0.25, z: 1 },
    },
  ];
  const parse = () => shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n'));
  expect(parseUnitySurface('--- !u!21 &1\nMaterial:\n  m_SavedProperties: {}\n', parse()).color).toEqual([
    0.5, 0.25, 1, 1,
  ]);
  docs[2]!.m_ColorMode = 1;
  expect(parse).toThrow('unsupported Unity shader graph base color default');
});
