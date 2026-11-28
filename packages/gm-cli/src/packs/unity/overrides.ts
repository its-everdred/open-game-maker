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
  options: { sourceGuid?: string; onStale?: (id: string, path: string) => void } = {},
): Map<string, UnityRecord> {
  if (!Array.isArray(modifications)) throw new Error('invalid prefab modifications');
  const records = new Map([...source].map(([id, record]) => [id, structuredClone(record)]));
  for (const modification of modifications) {
    const item = asObject(modification);
    const target = asObject(item.target);
    const id = target.fileID;
    const path = item.propertyPath;
    if (typeof id !== 'string' || typeof path !== 'string') throw new Error('invalid prefab override target');
    if (
      path === 'm_RootOrder' ||
      path.startsWith('m_LocalEulerAnglesHint.') ||
      /^m_LODs\.Array\.data\[\d+\]\.(screenRelativeHeight|fadeTransitionWidth)$/.test(path)
    )
      continue;
    if (options.sourceGuid && target.guid !== options.sourceGuid)
      throw new Error(`foreign prefab override target ${id}`);
    const record = records.get(id);
    if (!record) {
      const directStale =
        options.onStale &&
        options.sourceGuid &&
        target.guid === options.sourceGuid &&
        ![...records.values()].some((entry) => entry.type === 'PrefabInstance');
      if (!directStale) throw new Error(`missing prefab override target ${id}`);
      options.onStale!(id, path);
      continue;
    }
    if (
      [
        'Light',
        'MonoBehaviour',
        'BoxCollider',
        'MeshCollider',
        'SphereCollider',
        'CapsuleCollider',
        'ParticleSystem',
        'ParticleSystemRenderer',
      ].includes(record.type)
    )
      continue;
    if (
      record.type === 'Terrain' &&
      [
        'm_TreeCrossFadeLength',
        'm_DetailObjectDistance',
        'm_TreeBillboardDistance',
        'm_TreeMaximumFullLODCount',
      ].includes(path)
    )
      continue;
    if (
      (path === 'm_IsActive' && record.type === 'GameObject') ||
      (path === 'm_Enabled' && record.type === 'MeshRenderer')
    ) {
      if (!['0', '1', 0, 1].includes(item.value as string | number)) throw new Error(`invalid prefab override ${path}`);
      record.data[path] = String(item.value);
      continue;
    }
    if (path === 'm_Materials.Array.size' && record.type === 'MeshRenderer' && Array.isArray(record.data.m_Materials)) {
      const size = Number(item.value);
      if (!Number.isInteger(size) || size < 0 || size > 256) throw new Error('invalid prefab material count');
      const slots = record.data.m_Materials;
      while (slots.length < size) slots.push({ fileID: '0' });
      slots.length = size;
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
    if (path === 'm_ConstrainProportionsScale' && record.type === 'Transform') continue;
    if (
      record.type === 'MeshRenderer' &&
      [
        'm_CastShadows',
        'm_ReceiveShadows',
        'm_LightProbeUsage',
        'm_ReflectionProbeUsage',
        'm_SortingOrder',
        'm_DynamicOccludee',
        'm_StaticShadowCaster',
        'm_MotionVectors',
        'm_RayTracingMode',
        'm_RenderingLayerMask',
        'm_RendererPriority',
        'm_ScaleInLightmap',
        'm_ReceiveGI',
        'm_StitchLightmapSeams',
        'm_LightmapParameters',
        'm_ImportantGI',
        'm_PreserveUVs',
        'm_MinimumChartSize',
        'm_IgnoreNormalsForChartDetection',
      ].includes(path)
    )
      continue;
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
