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
