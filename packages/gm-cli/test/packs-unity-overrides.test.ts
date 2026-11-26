import { expect, it } from 'vitest';
import { parseUnityYaml } from '../src/packs/unity/yaml.js';
import { applyPrefabOverrides } from '../src/packs/unity/overrides.js';

it('applies instance transforms independently and rejects unknown overrides', () => {
  const source = parseUnityYaml(`--- !u!4 &123
Transform:
  m_LocalPosition: {x: 0, y: 1, z: 2}
`);
  const mods = [{ target: { fileID: '123' }, propertyPath: 'm_LocalPosition.x', value: '7.5' }];
  expect(applyPrefabOverrides(source, mods).get('123')?.data.m_LocalPosition).toEqual({ x: 7.5, y: '1', z: '2' });
  expect(source.get('123')?.data.m_LocalPosition).toEqual({ x: '0', y: '1', z: '2' });
  expect(() => applyPrefabOverrides(source, [{ ...mods[0], propertyPath: 'm_IsActive' }])).toThrow(
    'unsupported prefab override',
  );
  expect(() => applyPrefabOverrides(source, [{ ...mods[0], target: { fileID: '456' } }])).toThrow(
    'missing prefab override target',
  );
});

it('applies an overridden material reference and renderer visibility', () => {
  const source = parseUnityYaml(`--- !u!23 &5
MeshRenderer:
  m_Enabled: 1
  m_Materials:
  - {fileID: 2100000, guid: original}
`);
  const updated = applyPrefabOverrides(source, [
    {
      target: { fileID: '5' },
      propertyPath: 'm_Materials.Array.data[0]',
      objectReference: { fileID: '2100000', guid: 'replacement' },
    },
    { target: { fileID: '5' }, propertyPath: 'm_Enabled', value: '0' },
  ]);
  expect(updated.get('5')?.data).toMatchObject({ m_Enabled: '0', m_Materials: [{ guid: 'replacement' }] });
});

it('reports a stale direct override only when its source prefab has no nested instances', () => {
  const source = parseUnityYaml('--- !u!1 &1\nGameObject:\n  m_Name: House\n');
  const warnings: string[] = [];
  const modification = { target: { fileID: '99', guid: 'source' }, propertyPath: 'm_Name', value: 'Old' };
  applyPrefabOverrides(source, [modification], { sourceGuid: 'source', onStale: (id) => warnings.push(id) });
  expect(warnings).toEqual(['99']);
  const nested = parseUnityYaml('--- !u!1 &1\nGameObject:\n  m_Name: House\n--- !u!1001 &2\nPrefabInstance: {}\n');
  expect(() => applyPrefabOverrides(nested, [modification], { sourceGuid: 'source', onStale: () => {} })).toThrow(
    'missing prefab override target',
  );
  expect(() => applyPrefabOverrides(source, [modification], { sourceGuid: 'other', onStale: () => {} })).toThrow(
    'missing prefab override target',
  );
});

it('ignores light-only overrides while still rejecting unknown mesh overrides', () => {
  const source = parseUnityYaml('--- !u!108 &5\nLight:\n  m_Range: 10\n--- !u!23 &6\nMeshRenderer:\n  m_Enabled: 1\n');
  expect(() =>
    applyPrefabOverrides(source, [{ target: { fileID: '5' }, propertyPath: 'm_Range', value: '20' }]),
  ).not.toThrow();
  expect(() =>
    applyPrefabOverrides(source, [{ target: { fileID: '6' }, propertyPath: 'm_Custom', value: '20' }]),
  ).toThrow('unsupported prefab override');
});

it('ignores terrain vegetation display settings but refuses unrelated terrain changes', () => {
  const source = parseUnityYaml('--- !u!218 &5\nTerrain: {}\n');
  for (const propertyPath of [
    'm_TreeCrossFadeLength',
    'm_DetailObjectDistance',
    'm_TreeBillboardDistance',
    'm_TreeMaximumFullLODCount',
  ]) {
    expect(() => applyPrefabOverrides(source, [{ target: { fileID: '5' }, propertyPath, value: '10' }])).not.toThrow();
  }
  expect(() =>
    applyPrefabOverrides(source, [{ target: { fileID: '5' }, propertyPath: 'm_TerrainData', value: '10' }]),
  ).toThrow('unsupported prefab override');
});

it('resizes material slots before applying an instance replacement', () => {
  const source = parseUnityYaml('--- !u!23 &5\nMeshRenderer:\n  m_Materials:\n  - {fileID: 1, guid: old}\n');
  const updated = applyPrefabOverrides(source, [
    { target: { fileID: '5' }, propertyPath: 'm_Materials.Array.size', value: '2' },
    {
      target: { fileID: '5' },
      propertyPath: 'm_Materials.Array.data[1]',
      objectReference: { fileID: '2', guid: 'new' },
    },
  ]);
  expect(updated.get('5')?.data.m_Materials).toEqual([
    { fileID: '1', guid: 'old' },
    { fileID: '2', guid: 'new' },
  ]);
});
