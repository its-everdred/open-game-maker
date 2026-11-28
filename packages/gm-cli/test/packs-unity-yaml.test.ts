import { describe, expect, it } from 'vitest';
import { parseUnityYaml } from '../src/packs/unity/yaml.js';

describe('Unity YAML records', () => {
  it('preserves large file IDs and stripped references exactly', () => {
    const records = parseUnityYaml(`%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!4 &9223372036854775807 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 9223372036854775806, guid: abc}
  m_LocalPosition: {x: 1.5, y: 0, z: -2}
--- !u!1 &-42
GameObject:
  m_Name: House
`);
    expect(records.get('9223372036854775807')).toMatchObject({
      classId: 4,
      stripped: true,
      data: {
        m_CorrespondingSourceObject: { fileID: '9223372036854775806', guid: 'abc' },
        m_LocalPosition: { x: 1.5 },
      },
    });
    expect(records.get('-42')?.data.m_Name).toBe('House');
  });

  it('rejects duplicate ids and malformed records', () => {
    expect(() => parseUnityYaml('--- !u!1 &1\nGameObject: {}\n--- !u!4 &1\nTransform: {}')).toThrow('duplicate');
    expect(() => parseUnityYaml('--- !u!1 &1\nGameObject: [')).toThrow('invalid Unity YAML');
  });
});
