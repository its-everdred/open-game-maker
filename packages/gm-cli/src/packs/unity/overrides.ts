import type { UnityRecord } from './yaml.js';

type UnityObject = Record<string, unknown>;
function asObject(value: unknown): UnityObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid prefab modification');
  return value as UnityObject;
}

/** Apply instance-specific properties without mutating the source prefab. */
export function applyPrefabOverrides(
  source: Map<string, UnityRecord>,
  modifications: unknown,
): Map<string, UnityRecord> {
  if (!Array.isArray(modifications)) throw new Error('invalid prefab modifications');
  const records = new Map([...source].map(([id, record]) => [id, structuredClone(record)]));
  for (const modification of modifications) {
    const item = asObject(modification);
    const target = asObject(item.target);
    const id = target.fileID;
    const path = item.propertyPath;
    if (typeof id !== 'string' || typeof path !== 'string') throw new Error('invalid prefab override target');
    const record = records.get(id);
    if (!record) throw new Error(`missing prefab override target ${id}`);
    if (
      record.type === 'LODGroup' &&
      /^m_LODs\.Array\.data\[\d+\]\.(screenRelativeHeight|fadeTransitionWidth)$/.test(path)
    )
      continue;
    if (path === 'm_RootOrder' || path.startsWith('m_LocalEulerAnglesHint.')) continue;
    if (
      (path === 'm_IsActive' && record.type === 'GameObject') ||
      (path === 'm_Enabled' && record.type === 'MeshRenderer')
    ) {
      if (!['0', '1', 0, 1].includes(item.value as string | number)) throw new Error(`invalid prefab override ${path}`);
      record.data[path] = String(item.value);
      continue;
    }
    const material = /^m_Materials\.Array\.data\[(\d+)\]$/.exec(path);
    if (record.type === 'MeshRenderer' && material && Array.isArray(record.data.m_Materials)) {
      const index = Number(material[1]);
      if (index >= record.data.m_Materials.length) throw new Error(`invalid prefab override ${path}`);
      record.data.m_Materials[index] = structuredClone(asObject(item.objectReference));
      continue;
    }
    if (path === 'm_StaticEditorFlags' && record.type === 'GameObject') continue;
    if (path === 'm_Name' && record.type === 'GameObject') {
      record.data.m_Name = String(item.value ?? '');
      continue;
    }
    const match = /^(m_LocalPosition|m_LocalRotation|m_LocalScale)\.([xyzw])$/.exec(path);
    if (record.type === 'Transform' && match) {
      const value = Number(item.value);
      if (!Number.isFinite(value)) throw new Error(`invalid prefab override ${path}`);
      asObject(record.data[match[1]!])[match[2]!] = value;
      continue;
    }
    throw new Error(`unsupported prefab override ${path}`);
  }
  return records;
}
