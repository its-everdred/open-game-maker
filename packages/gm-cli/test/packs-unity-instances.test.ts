import { expect, it, vi } from 'vitest';
import { expandUnityInstances } from '../src/packs/unity/instances.js';
import { parseUnityYaml } from '../src/packs/unity/yaml.js';

const prefab = parseUnityYaml(`--- !u!1 &1
GameObject:
  m_Name: Roof
  m_Component:
  - component: {fileID: 2}
--- !u!4 &2
Transform:
  m_GameObject: {fileID: 1}
  m_Father: {fileID: 0}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
`);
const scene = parseUnityYaml(`--- !u!1 &10
GameObject:
  m_Name: Building
  m_Component:
  - component: {fileID: 11}
--- !u!4 &11
Transform:
  m_GameObject: {fileID: 10}
  m_Father: {fileID: 0}
  m_LocalPosition: {x: 4, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
--- !u!1001 &12
PrefabInstance:
  m_SourcePrefab: {fileID: 100100000, guid: roof}
  m_Modification:
    m_TransformParent: {fileID: 11}
    m_Modifications:
    - target: {fileID: 2, guid: roof}
      propertyPath: m_LocalPosition.y
      value: 3
    m_RemovedComponents: []
`);

it('expands a prefab under its parent with its instance override', () => {
  expect(expandUnityInstances(scene, () => prefab)).toMatchObject([
    { transformId: 'root/11', parentId: null, position: [4, 0, 0] },
    { transformId: 'root/12/2', parentId: 'root/11', position: [0, 3, 0] },
  ]);
  expect(prefab.get('2')?.data.m_LocalPosition).toEqual({ x: '0', y: '0', z: '0' });
});

it('refuses unsupported removals instead of producing an incomplete mesh', () => {
  const mutated = structuredClone(scene);
  (mutated.get('12')!.data.m_Modification as Record<string, unknown>).m_RemovedComponents = [{ fileID: '5' }];
  expect(() => expandUnityInstances(mutated, () => prefab)).toThrow('unsupported prefab m_RemovedComponents');
});

it('loads repeated prefabs once while keeping instance overrides independent', () => {
  const duplicated = structuredClone(scene);
  const second = structuredClone(duplicated.get('12')!);
  second.id = '13';
  const modification = second.data.m_Modification as { m_Modifications: Array<{ value: string }> };
  modification.m_Modifications[0]!.value = '8';
  duplicated.set('13', second);
  const load = vi.fn(() => prefab);
  const nodes = expandUnityInstances(duplicated, load);
  expect(load).toHaveBeenCalledTimes(1);
  expect(nodes.find((node) => node.transformId === 'root/12/2')?.position).toEqual([0, 3, 0]);
  expect(nodes.find((node) => node.transformId === 'root/13/2')?.position).toEqual([0, 8, 0]);
  expect(prefab.get('2')?.data.m_LocalPosition).toEqual({ x: '0', y: '0', z: '0' });
});
