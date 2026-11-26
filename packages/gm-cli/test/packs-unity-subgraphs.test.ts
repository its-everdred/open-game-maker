import { expect, it } from 'vitest';
import { shaderGraphBase, shaderGraphDocuments } from '../src/packs/unity/shadergraph.js';
import { inlineUnitySubgraphs } from '../src/packs/unity/subgraphs.js';

const guid = 'a'.repeat(32);
const edge = (from: string, to: string, input: number, output = 0) => ({
  m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
  m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
});
const text = (docs: object[]) => docs.map((doc) => JSON.stringify(doc)).join('\n');
const subgraph = text([
  { m_Type: 'UnityEditor.ShaderGraph.GraphData', m_Edges: [edge('input', 'output', 0)] },
  { m_ObjectId: 'output', m_Type: 'UnityEditor.ShaderGraph.SubGraphOutputNode', m_Slots: [{ m_Id: 'output-slot' }] },
  { m_ObjectId: 'output-slot', m_Type: 'UnityEditor.ShaderGraph.Vector4MaterialSlot', m_Id: 0, m_SlotType: 0 },
  { m_ObjectId: 'input', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
  {
    m_ObjectId: 'property',
    m_Type: 'UnityEditor.ShaderGraph.Internal.Vector3ShaderProperty',
    m_Guid: { m_GuidSerialized: 'input-guid' },
  },
]);
const outer = (includeInput = true) =>
  text([
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [edge('sub', 'base', 0), ...(includeInput ? [edge('sample', 'sub', 11)] : [])],
    },
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    {
      m_ObjectId: 'sub',
      m_Type: 'UnityEditor.ShaderGraph.SubGraphNode',
      m_SerializedSubGraph: JSON.stringify({ subGraph: { guid } }),
      m_PropertyGuids: ['input-guid'],
      m_PropertyIds: [11],
    },
  ]);

it('resolves a connected subgraph input into its caller and refuses an unconnected input', () => {
  const expanded = inlineUnitySubgraphs(outer(), (requested) => {
    expect(requested).toBe(guid);
    return subgraph;
  });
  expect(shaderGraphBase(expanded).textures).toEqual(['_SampleTexture2D_sample_Texture_1']);
  expect(() => inlineUnitySubgraphs(outer(false), () => subgraph)).toThrow(
    'unsupported unconnected Unity subgraph input',
  );
});

it('rejects cyclic subgraph references', () => {
  const cyclic = text([
    { m_Type: 'UnityEditor.ShaderGraph.GraphData', m_Edges: [edge('sub', 'output', 0)] },
    { m_ObjectId: 'output', m_Type: 'UnityEditor.ShaderGraph.SubGraphOutputNode', m_Slots: [{ m_Id: 'output-slot' }] },
    { m_ObjectId: 'output-slot', m_Type: 'UnityEditor.ShaderGraph.Vector4MaterialSlot', m_Id: 0, m_SlotType: 0 },
    {
      m_ObjectId: 'sub',
      m_Type: 'UnityEditor.ShaderGraph.SubGraphNode',
      m_SerializedSubGraph: JSON.stringify({ subGraph: { guid } }),
      m_PropertyGuids: [],
      m_PropertyIds: [],
    },
  ]);
  expect(() => inlineUnitySubgraphs(outer(), () => cyclic)).toThrow('cyclic Unity subgraph');
});

it('rejects ambiguous property bindings', () => {
  const source = outer()
    .replace('"m_PropertyGuids":["input-guid"]', '"m_PropertyGuids":["input-guid","input-guid"]')
    .replace('"m_PropertyIds":[11]', '"m_PropertyIds":[11,12]');
  expect(() => inlineUnitySubgraphs(source, () => subgraph)).toThrow('invalid Unity subgraph properties');
});

it('rejects duplicate object IDs and unsupported property output channels', () => {
  const duplicate = `${outer()}\n${JSON.stringify({ m_ObjectId: 'sample', m_Type: 'UnityEditor.ShaderGraph.ColorNode' })}`;
  expect(() => inlineUnitySubgraphs(duplicate, () => subgraph)).toThrow('duplicate Unity shader graph object ID');
  const channelOutput = subgraph.replace('"m_SlotId":0', '"m_SlotId":4');
  expect(() => inlineUnitySubgraphs(outer(), () => channelOutput)).toThrow(
    'unsupported Unity subgraph property output',
  );
});

it('preserves an explicit unconnected scalar default from the parent subgraph slot', async () => {
  const { parseUnitySurface } = await import('../src/packs/unity/material.js');
  const docs = shaderGraphDocuments(outer(false));
  docs.find((doc) => doc.m_ObjectId === 'sub')!.m_Slots = [{ m_Id: 'default-slot' }];
  docs.push({ m_ObjectId: 'default-slot', m_Id: 11, m_SlotType: 0, m_Value: 0.5 });
  const scalar = subgraph
    .replace('Vector3ShaderProperty', 'Vector1ShaderProperty')
    .replace('Vector4MaterialSlot', 'Vector1MaterialSlot');
  const expanded = inlineUnitySubgraphs(text(docs), () => scalar);
  const material = '--- !u!21 &1\nMaterial:\n  m_SavedProperties: {}\n';
  expect(parseUnitySurface(material, shaderGraphBase(expanded)).color).toEqual([0.5, 0.5, 0.5, 0.5]);
});

it('does not silently treat a vector input as a scalar', () => {
  const scalar = subgraph.replace('Vector3ShaderProperty', 'Vector1ShaderProperty');
  const expanded = inlineUnitySubgraphs(outer(), () => scalar);
  expect(() => shaderGraphBase(expanded)).toThrow('UnsupportedScalarConversion');
});

it('does not silently treat a vector subgraph result as a scalar', () => {
  const scalarOutput = subgraph.replace('Vector4MaterialSlot', 'Vector1MaterialSlot');
  const expanded = inlineUnitySubgraphs(outer(), () => scalarOutput);
  expect(() => shaderGraphBase(expanded)).toThrow('UnsupportedScalarConversion');
});

it('refuses vector widths that the material evaluator cannot represent', () => {
  expect(() =>
    inlineUnitySubgraphs(outer(), () => subgraph.replace('Vector4MaterialSlot', 'Vector2MaterialSlot')),
  ).toThrow('unsupported Unity subgraph output type');
  expect(() =>
    inlineUnitySubgraphs(outer(), () => subgraph.replace('Vector3ShaderProperty', 'Vector2ShaderProperty')),
  ).toThrow('unsupported Unity subgraph vector input');
});

it('does not load subgraphs outside the requested base-color path', () => {
  const docs = shaderGraphDocuments(outer());
  const graph = docs.find((doc) => doc.m_Type === 'UnityEditor.ShaderGraph.GraphData')!;
  (graph.m_Edges as object[]).push(edge('unused', 'other-output', 0));
  docs.push({ m_ObjectId: 'unused', m_Type: 'UnityEditor.ShaderGraph.SubGraphNode', m_SerializedSubGraph: 'invalid' });
  let calls = 0;
  expect(
    shaderGraphBase(
      inlineUnitySubgraphs(text(docs), () => {
        calls++;
        return subgraph;
      }),
    ).textures,
  ).toEqual(['_SampleTexture2D_sample_Texture_1']);
  expect(calls).toBe(1);
});

it('connects multiple inputs through an internal multiply node', () => {
  const child = text([
    {
      m_Type: 'UnityEditor.ShaderGraph.GraphData',
      m_Edges: [edge('input', 'multiply', 0), edge('factor', 'multiply', 1), edge('multiply', 'output', 0, 2)],
    },
    { m_ObjectId: 'output', m_Type: 'UnityEditor.ShaderGraph.SubGraphOutputNode', m_Slots: [{ m_Id: 'output-slot' }] },
    { m_ObjectId: 'output-slot', m_Type: 'UnityEditor.ShaderGraph.Vector4MaterialSlot', m_Id: 0, m_SlotType: 0 },
    { m_ObjectId: 'input', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'input-property' } },
    { m_ObjectId: 'factor', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'factor-property' } },
    {
      m_ObjectId: 'input-property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector3ShaderProperty',
      m_Guid: { m_GuidSerialized: 'input-guid' },
    },
    {
      m_ObjectId: 'factor-property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
      m_Guid: { m_GuidSerialized: 'factor-guid' },
    },
    { m_ObjectId: 'multiply', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' },
  ]);
  const docs = shaderGraphDocuments(outer());
  docs.find((doc) => doc.m_ObjectId === 'sub')!.m_PropertyGuids = ['input-guid', 'factor-guid'];
  docs.find((doc) => doc.m_ObjectId === 'sub')!.m_PropertyIds = [11, 12];
  const graph = docs.find((doc) => doc.m_Type === 'UnityEditor.ShaderGraph.GraphData')!;
  (graph.m_Edges as object[]).push(edge('factor-node', 'sub', 12));
  docs.push(
    { m_ObjectId: 'factor-node', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'outer-factor' } },
    {
      m_ObjectId: 'outer-factor',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
      m_DefaultReferenceName: '_Strength',
      m_Value: 0.5,
    },
  );
  expect(shaderGraphBase(inlineUnitySubgraphs(text(docs), () => child))).toMatchObject({
    textures: ['_SampleTexture2D_sample_Texture_1'],
    factors: [{ key: '_Strength', defaultValue: 0.5 }],
  });
});
