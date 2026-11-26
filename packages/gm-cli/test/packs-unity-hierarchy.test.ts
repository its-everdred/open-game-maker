import { describe, expect, it } from 'vitest';
import { resolveUnityHierarchy } from '../src/packs/unity/hierarchy.js';
import { parseUnityYaml } from '../src/packs/unity/yaml.js';

const fixture = `--- !u!1 &1
GameObject:
  m_Name: House
  m_Component:
  - component: {fileID: 2}
--- !u!4 &2
Transform:
  m_GameObject: {fileID: 1}
  m_Father: {fileID: 0}
  m_LocalPosition: {x: 4, y: 5, z: 6}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 2, y: 2, z: 2}
--- !u!1 &3
GameObject:
  m_Name: Roof
  m_Component:
  - component: {fileID: 4}
  - component: {fileID: 5}
  - component: {fileID: 6}
--- !u!4 &4
Transform:
  m_GameObject: {fileID: 3}
  m_Father: {fileID: 2}
  m_LocalPosition: {x: 0, y: 3, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
--- !u!33 &5
MeshFilter:
  m_Mesh: {fileID: 4300000, guid: mesh}
--- !u!23 &6
MeshRenderer:
  m_Materials:
  - {fileID: 2100000, guid: roof}
  - {fileID: 2100000, guid: trim}
`;

describe('Unity hierarchy', () => {
  it('retains parent transforms, mesh GUID and ordered material slots', () => {
    expect(resolveUnityHierarchy(parseUnityYaml(fixture))).toMatchObject([
      { name: 'House', parentId: null, position: [4, 5, 6], scale: [2, 2, 2] },
      {
        name: 'Roof',
        parentId: '2',
        position: [0, 3, 0],
        mesh: { fileId: '4300000', guid: 'mesh' },
        materials: [{ guid: 'roof' }, { guid: 'trim' }],
      },
    ]);
  });
  it('rejects missing and cyclic parents rather than exporting a partial assembly', () => {
    expect(() =>
      resolveUnityHierarchy(parseUnityYaml(fixture.replace('m_Father: {fileID: 2}', 'm_Father: {fileID: 99}'))),
    ).toThrow('missing Unity parent');
    expect(() =>
      resolveUnityHierarchy(parseUnityYaml(fixture.replace('m_Father: {fileID: 0}', 'm_Father: {fileID: 4}'))),
    ).toThrow('cyclic');
  });
});

it('keeps only the highest detail renderer in a Unity LOD group', () => {
  const lod = `${fixture}
--- !u!1 &7
GameObject:
  m_Name: Roof LOD1
  m_Component:
  - component: {fileID: 8}
  - component: {fileID: 9}
--- !u!4 &8
Transform:
  m_GameObject: {fileID: 7}
  m_Father: {fileID: 2}
  m_LocalPosition: {x: 0, y: 3, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
--- !u!23 &9
MeshRenderer:
  m_Materials: []
--- !u!205 &20
LODGroup:
  m_Enabled: 1
  m_LODs:
  - renderers:
    - renderer: {fileID: 6}
  - renderers:
    - renderer: {fileID: 9}
`;
  const nodes = resolveUnityHierarchy(parseUnityYaml(lod));
  expect(nodes.find((node) => node.name === 'Roof')?.rendererActive).toBe(true);
  expect(nodes.find((node) => node.name === 'Roof LOD1')?.rendererActive).toBe(false);
});
