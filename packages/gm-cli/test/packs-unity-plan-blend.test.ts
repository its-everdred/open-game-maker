import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { planUnityAssembly } from '../src/packs/unity/plan.js';

it('resolves texture paths inside blended graph terms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gm-unity-blend-plan-'));
  const model = 'a'.repeat(32),
    material = 'b'.repeat(32),
    shader = 'c'.repeat(32),
    first = 'd'.repeat(32),
    second = 'e'.repeat(32);
  try {
    await writeFile(join(root, 'roof.fbx'), 'fixture');
    await writeFile(
      join(root, 'roof.fbx.meta'),
      `guid: ${model}\nModelImporter:\n  fileIDToRecycleName:\n    4300000: Roof\n`,
    );
    for (const [name, guid] of [
      ['a', first],
      ['b', second],
    ]) {
      await writeFile(join(root, `${name}.png`), 'fixture');
      await writeFile(
        join(root, `${name}.png.meta`),
        `guid: ${guid}\nTextureImporter:\n  mipmaps:\n    sRGBTexture: 1\n  textureSettings:\n    filterMode: 1\n    wrapU: 0\n    wrapV: 0\n`,
      );
    }
    await writeFile(join(root, 'surface.mat.meta'), `guid: ${material}\n`);
    await writeFile(
      join(root, 'surface.mat'),
      `--- !u!21 &1\nMaterial:\n  m_Shader: {fileID: 4800000, guid: ${shader}}\n  m_SavedProperties:\n    m_Floats:\n    - _Weight: 0.5\n    m_Colors:\n    - _Offset: {r: 0.25, g: 0.125, b: 0, a: 0}\n    m_TexEnvs:\n    - _SampleTexture2D_a_Texture_1: {m_Texture: {guid: ${first}}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}\n    - _SampleTexture2D_b_Texture_1: {m_Texture: {guid: ${second}}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}\n`,
    );
    const edge = (from: string, to: string, input: number, output = 0) => ({
      m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
      m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: input },
    });
    const docs = [
      {
        m_Type: 'UnityEditor.ShaderGraph.GraphData',
        m_Edges: [edge('lerp', 'base', 0, 3), edge('a', 'lerp', 0), edge('b', 'lerp', 1), edge('amount', 'lerp', 2)],
      },
      {
        m_ObjectId: 'base',
        m_Type: 'UnityEditor.ShaderGraph.BlockNode',
        m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
      },
      { m_ObjectId: 'lerp', m_Type: 'UnityEditor.ShaderGraph.LerpNode' },
      ...['a', 'b'].map((id) => ({ m_ObjectId: id, m_Type: 'UnityEditor.ShaderGraph.SampleTexture2DNode' })),
      { m_ObjectId: 'amount', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'weight' } },
      {
        m_ObjectId: 'weight',
        m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
        m_DefaultReferenceName: '_Weight',
        m_Value: 0,
      },
    ];
    await writeFile(join(root, 'graph.shadergraph'), docs.map((doc) => JSON.stringify(doc)).join('\n'));
    await writeFile(join(root, 'graph.shadergraph.meta'), `guid: ${shader}\n`);
    const prefab = join(root, 'roof.prefab');
    await writeFile(
      prefab,
      `--- !u!1 &1\nGameObject:\n  m_Name: Roof\n  m_Component:\n  - component: {fileID: 2}\n  - component: {fileID: 3}\n  - component: {fileID: 4}\n--- !u!4 &2\nTransform:\n  m_GameObject: {fileID: 1}\n  m_Father: {fileID: 0}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n--- !u!33 &3\nMeshFilter:\n  m_Mesh: {fileID: 4300000, guid: ${model}}\n--- !u!23 &4\nMeshRenderer:\n  m_Materials:\n  - {fileID: 2100000, guid: ${material}}\n`,
    );
    const plan = await planUnityAssembly(root, prefab);
    expect(plan[0]?.surfaces[0]?.blends).toMatchObject([
      {
        a: { texturePaths: [join(root, 'a.png')], textureSrgb: [true] },
        b: { texturePaths: [join(root, 'b.png')], textureSrgb: [true] },
        weight: 0.5,
      },
    ]);
    docs[0]!.m_Edges = [
      edge('lerp', 'base', 0, 3),
      edge('a', 'lerp', 0),
      edge('b', 'lerp', 1),
      edge('b', 'lerp', 2, 4),
    ];
    await writeFile(join(root, 'graph.shadergraph'), docs.map((doc) => JSON.stringify(doc)).join('\n'));
    const masked = await planUnityAssembly(root, prefab);
    expect(masked[0]?.surfaces[0]?.blends).toMatchObject([
      { weight: { term: { texturePaths: [join(root, 'b.png')], textureSrgb: [true] }, channel: 0 } },
    ]);
    docs[0]!.m_Edges = [
      edge('lerp', 'base', 0, 3),
      edge('a', 'lerp', 0),
      edge('b', 'lerp', 1),
      edge('inverse', 'lerp', 2, 1),
      edge('b', 'inverse', 0, 4),
    ];
    docs.push({ m_ObjectId: 'inverse', m_Type: 'UnityEditor.ShaderGraph.OneMinusNode' } as (typeof docs)[number]);
    await writeFile(join(root, 'graph.shadergraph'), docs.map((doc) => JSON.stringify(doc)).join('\n'));
    const inverted = await planUnityAssembly(root, prefab);
    expect(inverted[0]?.surfaces[0]?.blends).toMatchObject([
      { weight: { term: { texturePaths: [join(root, 'b.png')] }, channel: 0, invert: true } },
    ]);
    docs[0]!.m_Edges = [
      edge('lerp', 'base', 0, 3),
      edge('a', 'lerp', 0),
      edge('b', 'lerp', 1),
      edge('inverse', 'lerp', 2, 1),
      edge('scale', 'inverse', 0, 2),
      edge('b', 'scale', 0, 4),
      edge('amount', 'scale', 1),
    ];
    docs.push({ m_ObjectId: 'scale', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' } as (typeof docs)[number]);
    await writeFile(join(root, 'graph.shadergraph'), docs.map((doc) => JSON.stringify(doc)).join('\n'));
    const scaled = await planUnityAssembly(root, prefab);
    expect(scaled[0]?.surfaces[0]?.blends).toMatchObject([
      {
        weight: {
          term: { texturePaths: [join(root, 'b.png')], color: [0.5, 0.5, 0.5, 0.5] },
          channel: 0,
          invert: true,
        },
      },
    ]);
    const subGuid = 'f'.repeat(32);
    const subgraph = [
      { m_Type: 'UnityEditor.ShaderGraph.GraphData', m_Edges: [edge('input', 'output', 0)] },
      {
        m_ObjectId: 'output',
        m_Type: 'UnityEditor.ShaderGraph.SubGraphOutputNode',
        m_Slots: [{ m_Id: 'output-slot' }],
      },
      { m_ObjectId: 'output-slot', m_Type: 'UnityEditor.ShaderGraph.Vector4MaterialSlot', m_Id: 0, m_SlotType: 0 },
      { m_ObjectId: 'input', m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: 'property' } },
      {
        m_ObjectId: 'property',
        m_Type: 'UnityEditor.ShaderGraph.Internal.Vector3ShaderProperty',
        m_Guid: { m_GuidSerialized: 'input-guid' },
      },
    ];
    await writeFile(join(root, 'nested.shadersubgraph'), subgraph.map((doc) => JSON.stringify(doc)).join('\n'));
    await writeFile(join(root, 'nested.shadersubgraph.meta'), `guid: ${subGuid}\n`);
    docs[0]!.m_Edges = [
      edge('lerp', 'base', 0, 3),
      edge('a', 'lerp', 0),
      edge('sub', 'lerp', 1),
      edge('b', 'sub', 11),
      edge('inverse', 'lerp', 2, 1),
      edge('scale', 'inverse', 0, 2),
      edge('b', 'scale', 0, 4),
      edge('amount', 'scale', 1),
    ];
    docs.push({
      m_ObjectId: 'sub',
      m_Type: 'UnityEditor.ShaderGraph.SubGraphNode',
      m_SerializedSubGraph: JSON.stringify({ subGraph: { guid: subGuid } }),
      m_PropertyGuids: ['input-guid'],
      m_PropertyIds: [11],
    } as (typeof docs)[number]);
    await writeFile(join(root, 'graph.shadergraph'), docs.map((doc) => JSON.stringify(doc)).join('\n'));
    const nested = await planUnityAssembly(root, prefab);
    expect(nested[0]?.surfaces[0]?.blends).toMatchObject([
      { b: { texturePaths: [join(root, 'b.png')] }, weight: { term: { color: [0.5, 0.5, 0.5, 0.5] }, invert: true } },
    ]);
    docs[0]!.m_Edges = [
      edge('lerp', 'base', 0, 3),
      edge('a', 'lerp', 0),
      edge('b', 'lerp', 1),
      edge('clamp', 'lerp', 2, 3),
      edge('add', 'clamp', 0, 2),
      edge('zero', 'clamp', 1),
      edge('one', 'clamp', 2),
      edge('scale', 'add', 0, 2),
      edge('offset', 'add', 1),
      edge('b', 'scale', 0, 4),
      edge('amount', 'scale', 1),
    ];
    docs.push(
      { m_ObjectId: 'clamp', m_Type: 'UnityEditor.ShaderGraph.ClampNode' } as (typeof docs)[number],
      { m_ObjectId: 'add', m_Type: 'UnityEditor.ShaderGraph.AddNode' } as (typeof docs)[number],
      ...[
        ['zero', 0],
        ['one', 1],
        ['offset', 0.1],
      ].map(
        ([id, value]) =>
          ({ m_ObjectId: id, m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: value }) as (typeof docs)[number],
      ),
    );
    await writeFile(join(root, 'graph.shadergraph'), docs.map((doc) => JSON.stringify(doc)).join('\n'));
    const calculated = await planUnityAssembly(root, prefab);
    expect(calculated[0]?.surfaces[0]?.blends).toMatchObject([
      {
        weight: {
          op: 'clamp',
          args: [
            {
              op: 'add',
              args: [
                { op: 'multiply', args: [{ term: { texturePaths: [join(root, 'b.png')] }, channel: 0 }, 0.5] },
                0.1,
              ],
            },
            0,
            1,
          ],
        },
      },
    ]);
    docs[0]!.m_Edges!.push(edge('uv', 'b', 2));
    docs.push({
      m_ObjectId: 'uv',
      m_Type: 'UnityEditor.ShaderGraph.UVNode',
      m_OutputChannel: 2,
    } as (typeof docs)[number]);
    await writeFile(join(root, 'graph.shadergraph'), docs.map((doc) => JSON.stringify(doc)).join('\n'));
    const uvPlan = await planUnityAssembly(root, prefab);
    expect(uvPlan[0]?.surfaces[0]?.blends).toMatchObject([
      {
        b: { textures: [{ uv: 2 }] },
        weight: {
          op: 'clamp',
          args: [
            {
              op: 'add',
              args: [{ op: 'multiply', args: [{ term: { textures: [{ uv: 2 }] }, channel: 0 }, 0.5] }, 0.1],
            },
            0,
            1,
          ],
        },
      },
    ]);
    docs[0]!.m_Edges = docs[0]!.m_Edges!.filter(
      (entry) => !(entry.m_InputSlot.m_Node.m_Id === 'b' && entry.m_InputSlot.m_SlotId === 2),
    );
    docs[0]!.m_Edges!.push(
      edge('uvadd', 'b', 2, 2),
      edge('uvscale', 'uvadd', 0, 2),
      edge('uvparam', 'uvadd', 1),
      edge('uv', 'uvscale', 0),
      edge('amount', 'uvscale', 1),
    );
    docs.push(
      { m_ObjectId: 'uvadd', m_Type: 'UnityEditor.ShaderGraph.AddNode' } as (typeof docs)[number],
      { m_ObjectId: 'uvscale', m_Type: 'UnityEditor.ShaderGraph.MultiplyNode' } as (typeof docs)[number],
      {
        m_ObjectId: 'uvparam',
        m_Type: 'UnityEditor.ShaderGraph.PropertyNode',
        m_Property: { m_Id: 'uvproperty' },
      } as (typeof docs)[number],
      {
        m_ObjectId: 'uvproperty',
        m_Type: 'UnityEditor.ShaderGraph.Internal.Vector2ShaderProperty',
        m_DefaultReferenceName: '_Offset',
        m_Value: { x: 0, y: 0 },
      } as (typeof docs)[number],
    );
    await writeFile(join(root, 'graph.shadergraph'), docs.map((doc) => JSON.stringify(doc)).join('\n'));
    const affinePlan = await planUnityAssembly(root, prefab);
    expect(affinePlan[0]?.surfaces[0]?.blends).toMatchObject([
      { b: { textures: [{ uv: 2, uvTransform: [0.5, 0, 0.25, 0, 0.5, 0.125] }] } },
    ]);
    docs[0]!.m_Edges = [edge('power', 'base', 0, 2), edge('b', 'power', 0), edge('amount', 'power', 1)];
    docs.push({ m_ObjectId: 'power', m_Type: 'UnityEditor.ShaderGraph.PowerNode' } as (typeof docs)[number]);
    await writeFile(join(root, 'graph.shadergraph'), docs.map((doc) => JSON.stringify(doc)).join('\n'));
    const adjustedPlan = await planUnityAssembly(root, prefab);
    expect(adjustedPlan[0]?.surfaces[0]).toMatchObject({
      adjustment: { op: 'power', amount: 0.5 },
      products: [{ texturePaths: [join(root, 'b.png')], textureSrgb: [true] }],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
