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
      `--- !u!21 &1\nMaterial:\n  m_Shader: {fileID: 4800000, guid: ${shader}}\n  m_SavedProperties:\n    m_Floats:\n    - _Weight: 0.5\n    m_TexEnvs:\n    - _SampleTexture2D_a_Texture_1: {m_Texture: {guid: ${first}}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}\n    - _SampleTexture2D_b_Texture_1: {m_Texture: {guid: ${second}}, m_Scale: {x: 1, y: 1}, m_Offset: {x: 0, y: 0}}\n`,
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
