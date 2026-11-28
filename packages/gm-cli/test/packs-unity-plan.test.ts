import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectUnityAssembly, planUnityAssembly } from '../src/packs/unity/plan.js';

it('resolves mesh and material GUIDs and refuses missing model metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gm-unity-plan-'));
  const meshGuid = 'a'.repeat(32),
    materialGuid = 'b'.repeat(32);
  try {
    await writeFile(join(root, 'model.fbx'), 'fixture');
    await writeFile(
      join(root, 'model.fbx.meta'),
      `guid: ${meshGuid}\nModelImporter:\n  fileIDToRecycleName:\n    4300000: Roof\n`,
    );
    await writeFile(join(root, 'roof.mat'), '--- !u!21 &2100000\nMaterial:\n  m_SavedProperties: {}\n');
    await writeFile(join(root, 'roof.mat.meta'), `guid: ${materialGuid}\n`);
    const prefab = join(root, 'house.prefab');
    await writeFile(
      prefab,
      `--- !u!1 &1
GameObject:
  m_Name: Roof
  m_Component:
  - component: {fileID: 2}
  - component: {fileID: 3}
  - component: {fileID: 4}
--- !u!4 &2
Transform:
  m_GameObject: {fileID: 1}
  m_Father: {fileID: 0}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
--- !u!33 &3
MeshFilter:
  m_Mesh: {fileID: 4300000, guid: ${meshGuid}}
--- !u!23 &4
MeshRenderer:
  m_Materials:
  - {fileID: 2100000, guid: ${materialGuid}}
`,
    );
    expect(await planUnityAssembly(root, prefab)).toMatchObject([
      {
        model: { path: join(root, 'model.fbx'), name: 'Roof', unityMesh: true },
        surfaces: [{ path: join(root, 'roof.mat'), color: [1, 1, 1, 1] }],
      },
    ]);
    expect(await inspectUnityAssembly(root, prefab)).toMatchObject([
      { transformId: 'root/2', name: 'Roof', parentId: null },
    ]);
    const shaderGuid = 'c'.repeat(32);
    const edge = (from: string, to: string, slot: number, output: number) => ({
      m_InputSlot: { m_Node: { m_Id: to }, m_SlotId: slot },
      m_OutputSlot: { m_Node: { m_Id: from }, m_SlotId: output },
    });
    const graph = [
      {
        m_Type: 'UnityEditor.ShaderGraph.GraphData',
        m_Edges: [
          edge('lerp', 'alpha', 0, 3),
          edge('front', 'lerp', 0, 0),
          edge('side', 'lerp', 1, 0),
          edge('fresnel', 'lerp', 2, 3),
          edge('power', 'fresnel', 2, 0),
        ],
      },
      { m_ObjectId: 'alpha', m_SerializedDescriptor: 'SurfaceDescription.Alpha' },
      {
        m_ObjectId: 'base',
        m_Type: 'UnityEditor.ShaderGraph.BlockNode',
        m_SerializedDescriptor: 'SurfaceDescription.BaseColor',
        m_Slots: [{ m_Id: 'baseSlot' }],
      },
      {
        m_ObjectId: 'baseSlot',
        m_Type: 'UnityEditor.ShaderGraph.ColorRGBMaterialSlot',
        m_ColorMode: 0,
        m_Id: 0,
        m_SlotType: 0,
        m_Value: { x: 1, y: 1, z: 1 },
      },
      { m_ObjectId: 'lerp', m_Type: 'UnityEditor.ShaderGraph.LerpNode' },
      { m_ObjectId: 'fresnel', m_Type: 'UnityEditor.ShaderGraph.FresnelNode' },
      { m_ObjectId: 'power', m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Slots: [{ m_Id: 'slot' }] },
      { m_ObjectId: 'slot', m_Id: 1, m_SlotType: 0, m_Value: 1 },
      ...['front', 'side'].flatMap((name) => [
        { m_ObjectId: name, m_Type: 'UnityEditor.ShaderGraph.PropertyNode', m_Property: { m_Id: `${name}Prop` } },
        {
          m_ObjectId: `${name}Prop`,
          m_Type: 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
          m_DefaultReferenceName: `_${name}`,
          m_Value: name === 'front' ? 0.4 : 0.9,
        },
      ]),
    ];
    await writeFile(join(root, 'glass.shadergraph'), graph.map((doc) => JSON.stringify(doc)).join('\n'));
    await writeFile(join(root, 'glass.shadergraph.meta'), `guid: ${shaderGuid}\n`);
    await writeFile(
      join(root, 'roof.mat'),
      `--- !u!21 &2100000\nMaterial:\n  m_Shader: {guid: ${shaderGuid}}\n  stringTagMap: {RenderType: Transparent}\n  m_SavedProperties:\n    m_Floats:\n    - _SurfaceType: 1\n    - _BlendMode: 0\n    - _SrcBlend: 1\n    - _DstBlend: 10\n    - _DoubleSidedEnable: 0\n`,
    );
    const warnings: string[] = [];
    expect(await planUnityAssembly(root, prefab, (warning) => warnings.push(warning))).toMatchObject([
      { surfaces: [{ opacity: { color: [0.4, 0.4, 0.4, 0.4] } }] },
    ]);
    expect(warnings).toEqual([expect.stringContaining('view-dependent opacity approximated')]);
    await writeFile(
      join(root, 'roof.mat'),
      `--- !u!21 &2100000\nMaterial:\n  m_Shader: {guid: ${shaderGuid}}\n  stringTagMap: {RenderType: Opaque}\n  m_SavedProperties:\n    m_Floats:\n    - _SurfaceType: 0\n    - _BlendMode: 1\n    - _SrcBlend: 1\n    - _DstBlend: 1\n`,
    );
    expect(await planUnityAssembly(root, prefab)).toMatchObject([{ surfaces: [{ color: [1, 1, 1, 1] }] }]);
    const buildingOnly = await readFile(prefab, 'utf8');
    await writeFile(
      prefab,
      buildingOnly +
        `--- !u!1 &10
GameObject:
  m_Name: Character
  m_Component:
  - component: {fileID: 11}
  - component: {fileID: 12}
--- !u!4 &11
Transform:
  m_GameObject: {fileID: 10}
  m_Father: {fileID: 0}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
--- !u!137 &12
SkinnedMeshRenderer:
  m_Enabled: 1
`,
    );
    expect(await planUnityAssembly(root, prefab, undefined, 'Roof')).toHaveLength(1);
    await expect(planUnityAssembly(root, prefab)).rejects.toThrow('unsupported Unity skinned mesh');
    await writeFile(prefab, buildingOnly);
    await writeFile(join(root, 'model.fbx.meta'), `guid: ${meshGuid}\nModelImporter: {}\n`);
    await expect(planUnityAssembly(root, prefab)).rejects.toThrow('missing Unity mesh name');
    const contents = await readFile(prefab, 'utf8');
    await writeFile(prefab, contents.replace('MeshRenderer:\n', 'MeshRenderer:\n  m_Enabled: 0\n'));
    await rm(join(root, 'model.fbx'));
    expect(await planUnityAssembly(root, prefab)).toMatchObject([{ rendererActive: false, surfaces: [] }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('lists and plans a scene with the same stale override warning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gm-unity-stale-'));
  const guid = 'd'.repeat(32);
  try {
    await writeFile(
      join(root, 'house.prefab'),
      `--- !u!1 &1
GameObject:
  m_Name: House
  m_Component:
  - component: {fileID: 2}
--- !u!4 &2
Transform:
  m_GameObject: {fileID: 1}
  m_Father: {fileID: 0}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
`,
    );
    await writeFile(join(root, 'house.prefab.meta'), `guid: ${guid}\n`);
    const scene = join(root, 'scene.unity');
    await writeFile(
      scene,
      `--- !u!1001 &12
PrefabInstance:
  m_SourcePrefab: {fileID: 100100000, guid: ${guid}}
  m_Modification:
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 99, guid: ${guid}}
      propertyPath: m_Name
      value: Old
`,
    );
    const listed: string[] = [],
      planned: string[] = [];
    expect(await inspectUnityAssembly(root, scene, undefined, (warning) => listed.push(warning))).toMatchObject([
      { name: 'House', transformId: 'root/12/2' },
    ]);
    await planUnityAssembly(root, scene, (warning) => planned.push(warning));
    expect(listed).toEqual(planned);
    expect(listed[0]).toContain('stale override');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
