import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { planUnityAssembly } from '../src/packs/unity/plan.js';

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
        model: { path: join(root, 'model.fbx'), name: 'Roof' },
        surfaces: [{ path: join(root, 'roof.mat'), color: [1, 1, 1, 1] }],
      },
    ]);
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
