import { expect, it } from 'vitest';
import { shaderGraphBase } from '../src/packs/unity/shadergraph.js';
import { parseUnitySurface } from '../src/packs/unity/material.js';

it('resolves material-driven tiling, offsets and clockwise Unity rotation into texture coordinates', () => {
  const edge = (from: string, to: string, input: number, output = 0) => ({
    m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
  });
  const graph = {
    m_Type: 'UnityEditor.ShaderGraph.GraphData',
    m_Edges: [
      edge('tex', 'base', 0),
      edge('rotate', 'tex', 2, 3),
      edge('add', 'rotate', 0, 2),
      edge('center', 'rotate', 1),
      edge('angle', 'rotate', 2),
      edge('multiply', 'add', 0, 2),
      edge('offset', 'add', 1, 6),
      edge('uv', 'multiply', 0),
      edge('scale', 'multiply', 1, 6),
      edge('split', 'scale', 0, 1),
      edge('split', 'scale', 1, 2),
      edge('split', 'offset', 0, 3),
      edge('split', 'offset', 1, 4),
      edge('params', 'split', 0),
    ],
  };
  const docs = [
    graph,
    {
      m_ObjectId: 'base',
      m_Type: 'UnityEditor.ShaderGraph.BlockNode',
      m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
    },
    { m_ObjectId: 'tex', m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' },
    { m_ObjectId: 'rotate', m_Type: 'UnityEditor.ShaderGraph.RotateNode', m_Unit: 1 },
    { m_ObjectId: 'add', m_Type: 'UnityEditor.ShaderGraph.AddNode' },
    { m_ObjectId: 'multiply', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' },
    { m_ObjectId: 'scale', m_Type: 'UnityEditor.ShaderGraph.CombineNode' },
    { m_ObjectId: 'offset', m_Type: 'UnityEditor.ShaderGraph.CombineNode' },
    { m_ObjectId: 'split', m_Type: 'UnityEditor.ShaderGraph.SplitNode' },
    { m_ObjectId: 'uv', m_Type: 'UnityEditor.ShaderGraph.UVNode', m_OutputChannel: 1 },
    ...['params', 'center', 'angle'].map((id) => ({
      m_ObjectId: id,
      m_Type: 'UnityEditor.ShaderGraph.PropertyNode',
      m_Property: { m_Id: `${id}-property` },
    })),
    {
      m_ObjectId: 'params-property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.ColorShaderProperty',
      m_DefaultReferenceName: 'Tiling',
      m_Value: { r: 1, g: 1, b: 0, a: 0 },
    },
    {
      m_ObjectId: 'center-property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector2ShaderProperty',
      m_DefaultReferenceName: 'Center',
      m_Value: { x: 0.5, y: 0.5 },
    },
    {
      m_ObjectId: 'angle-property',
      m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
      m_DefaultReferenceName: 'Angle',
      m_Value: 0,
    },
  ];
  const source = docs.map((doc) => JSON.stringify(doc)).join('\n');
  const graphResult = shaderGraphBase(
    source,
    new Map([['Angle', 90]]),
    new Map([['Tiling', { r: 2, g: 3, b: 0.25, a: 0.5 }]]),
  );
  expect(graphResult.textureChannels).toEqual([1]);
  const matrix = graphResult.textureUvTransforms![0]!.matrix;
  [0, 3, 0.5, -2, 0, 0.75].forEach((value, index) => expect(matrix[index]).toBeCloseTo(value, 7));
  const material = `--- !u!21 &1
Material:
  m_SavedProperties:
    m_TexEnvs:
    - _SampleTexture2D_tex_Texture_1:
        m_Texture: {fileID: 2800000, guid: abcdef, type: 3}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
`;
  expect(parseUnitySurface(material, graphResult).textures[0]?.uvTransform).toEqual(matrix);
  expect(() =>
    parseUnitySurface(material.replace('m_Scale: {x: 1, y: 1}', 'm_Scale: {x: 2, y: 1}'), graphResult),
  ).toThrow('unsupported texture property transform');
  const nonlinear = structuredClone(docs);
  nonlinear[0]!.m_Edges.find(
    (item) => item.m_InputSlot.m_Node.m_Id === 'multiply' && item.m_InputSlot.m_SlotId === 1,
  )!.m_OutputSlot = { m_Node: { m_Id: 'uv' }, m_SlotId: 0 };
  expect(() => shaderGraphBase(nonlinear.map((doc) => JSON.stringify(doc)).join('\n'))).toThrow(
    'nonlinear Unity UV graph',
  );
  const implicit = structuredClone(docs);
  implicit[0]!.m_Edges = implicit[0]!.m_Edges.filter(
    (item) => !(item.m_InputSlot.m_Node.m_Id === 'rotate' && item.m_InputSlot.m_SlotId === 0),
  );
  Object.assign(
    implicit.find((doc) => doc.m_ObjectId === 'rotate')!,
    { m_Slots: [{ m_Id: 'implicit-uv' }] },
  );
  implicit.push({
    m_ObjectId: 'implicit-uv',
    m_Type: 'UnityEditor.ShaderGraph.UVMaterialSlot',
    m_Id: 0,
    m_SlotType: 0,
    m_Channel: 2,
  } as (typeof implicit)[number]);
  const implicitUv = shaderGraphBase(implicit.map((doc) => JSON.stringify(doc)).join('\n'), new Map([['Angle', 90]]));
  expect(implicitUv.textureChannels).toEqual([2]);
  [0, 1, 0, -1, 0, 1].forEach((value, index) =>
    expect(implicitUv.textureUvTransforms![0]!.matrix[index]).toBeCloseTo(value, 7),
  );
});
