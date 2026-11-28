import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';
import { parseUnitySurface } from '../src/packs/unity/material.js';
import { compileWorldUv } from '../src/packs/unity/world-uv.js';

it('resolves absolute-world planar projection and rejects nonlinear or non-world inputs', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const graph = {
    m_Type: 'UnityEditor.ShaderGraph.GraphData',
    m_Edges: [
      edge('sample', 'base', 0),
      edge('combine', 'sample', 2, 6),
      edge('split', 'combine', 0, 1),
      edge('split', 'combine', 1, 3),
      edge('divide', 'split', 0, 2),
      edge('position', 'divide', 0),
      edge('scale', 'divide', 1),
    ],
  };
  const docs = [
    graph,
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'combine', m_Type: 'UnityEditor.ShaderGraph.CombineNode' },
    { m_ObjectId: 'split', m_Type: 'UnityEditor.ShaderGraph.SplitNode' },
    { m_ObjectId: 'divide', m_Type: 'UnityEditor.ShaderGraph.DivideNode' },
    { m_ObjectId: 'position', m_Type: 'UnityEditor.ShaderGraph.PositionNode', m_Space: 4 },
    { m_ObjectId: 'scale', m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: 2 },
  ];
  const parse = () => shaderGraphBase(docs.map((doc) => JSON.stringify(doc)).join('\n'));
  expect(parse().textureWorldTransforms).toEqual([[0.5, 0, 0, 0, 0, 0, 0.5, 0]]);
  docs.push({
    m_ObjectId: 'narrow',
    m_Type: 'UnityEditor.ShaderGraph.UnsupportedScalarConversion',
  } as (typeof docs)[number]);
  const oldX = graph.m_Edges[2]!.m_OutputSlot;
  graph.m_Edges[2]!.m_OutputSlot = { m_Node: { m_Id: 'narrow' }, m_SlotId: 0 };
  graph.m_Edges.push(edge('position', 'narrow', 0));
  expect(parse().textureWorldTransforms).toEqual([[1, 0, 0, 0, 0, 0, 0.5, 0]]);
  graph.m_Edges[2]!.m_OutputSlot = oldX;
  const material =
    '--- !u!21 &1\nMaterial:\n  m_SavedProperties:\n    m_TexEnvs:\n    - _SampleTexture2D_sample_Texture_1: {m_Texture: {guid: abcdef}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}\n';
  expect(parseUnitySurface(material, parse()).textures[0]?.worldUvTransform).toEqual([0.5, 0, 0, 0, 0, 0, 0.5, 0]);
  docs[7]!.m_Value = -2;
  docs.push({ m_ObjectId: 'absolute', m_Type: 'UnityEditor.ShaderGraph.AbsoluteNode' } as (typeof docs)[number]);
  graph.m_Edges[6]!.m_OutputSlot = { m_Node: { m_Id: 'absolute' }, m_SlotId: 1 };
  graph.m_Edges.push(edge('scale', 'absolute', 0));
  expect(parse().textureWorldTransforms).toEqual([[0.5, 0, 0, 0, 0, 0, 0.5, 0]]);
  docs[6]!.m_Space = 0;
  expect(parse).toThrow('unsupported Unity world UV node');
  docs[6]!.m_Space = 4;
  graph.m_Edges[6]!.m_OutputSlot = { m_Node: { m_Id: 'position' }, m_SlotId: 0 };
  expect(parse).toThrow('nonlinear Unity world UV graph');
});

it('uses Vector3 input slot defaults for world projection scale', () => {
  const byId = new Map<string, Record<string, unknown>>([
    ['position', { m_Type: 'UnityEditor.ShaderGraph.PositionNode', m_Space: 4 }],
    ['divide', { m_Type: 'UnityEditor.ShaderGraph.DivideNode' }],
    [
      'vector',
      {
        m_Type: 'UnityEditor.ShaderGraph.Vector3Node',
        m_Value: { x: 0, y: 0, z: 0 },
        m_Slots: [{ m_Id: 'x' }, { m_Id: 'y' }, { m_Id: 'z' }],
      },
    ],
    ['x', { m_Id: 1, m_SlotType: 0, m_Value: 2 }],
    ['y', { m_Id: 2, m_SlotType: 0, m_Value: 4 }],
    ['z', { m_Id: 3, m_SlotType: 0, m_Value: 8 }],
  ]);
  const incoming = new Map([
    [
      'divide',
      [
        { node: 'position', inputSlot: 0, outputSlot: 0 },
        { node: 'vector', inputSlot: 1, outputSlot: 0 },
      ],
    ],
  ]);
  expect(
    compileWorldUv({ node: 'divide', inputSlot: 0, outputSlot: 2 }, byId, incoming, new Map(), new Map(), new Set()),
  ).toEqual([0.5, 0, 0, 0, 0, 0.25, 0, 0]);
});
