import type { UnityRecord } from './yaml.js';

type ObjectValue = Record<string, unknown>;
export type UnityReference = { fileId: string; guid?: string };
export type UnityMeshNode = {
  name: string;
  transformId: string;
  parentId: string | null;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  mesh?: UnityReference;
  materials: UnityReference[];
  active: boolean;
  rendererActive: boolean;
};

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid Unity object');
  return value as ObjectValue;
}
function reference(value: unknown): UnityReference {
  const ref = object(value);
  if (typeof ref.fileID !== 'string') throw new Error('invalid Unity fileID');
  return { fileId: ref.fileID, ...(typeof ref.guid === 'string' ? { guid: ref.guid } : {}) };
}
function vector(value: unknown, keys: readonly string[]): number[] {
  const source = object(value);
  return keys.map((key) => {
    const n = Number(source[key]);
    if (!Number.isFinite(n)) throw new Error(`invalid Unity transform ${key}`);
    return n;
  });
}

/** Resolve a self-contained hierarchy, preserving local transforms and material slot order. */
export function resolveUnityHierarchy(
  records: Map<string, UnityRecord>,
  options: { allowExternalParents?: boolean } = {},
): UnityMeshNode[] {
  const transforms = [...records.values()].filter((record) => record.type === 'Transform' && !record.stripped);
  const nodes = new Map<string, UnityMeshNode>();
  const lowerLods = new Set<string>();
  const primaryLods = new Set<string>();
  for (const group of records.values()) {
    if (group.type !== 'LODGroup' || group.data.m_Enabled === '0' || !Array.isArray(group.data.m_LODs)) continue;
    group.data.m_LODs.forEach((level, index) => {
      const renderers = object(level).renderers;
      if (!Array.isArray(renderers)) throw new Error('invalid Unity LOD renderers');
      for (const entry of renderers) {
        const renderer = reference(object(entry).renderer).fileId;
        (index === 0 ? primaryLods : lowerLods).add(renderer);
      }
    });
  }
  for (const transform of transforms) {
    const data = transform.data;
    const gameObject = records.get(reference(data.m_GameObject).fileId);
    if (!gameObject || gameObject.type !== 'GameObject') throw new Error(`missing GameObject for ${transform.id}`);
    const parent = reference(data.m_Father).fileId;
    const components = Array.isArray(gameObject.data.m_Component) ? gameObject.data.m_Component : [];
    const linked = components.map((entry) => records.get(reference(object(entry).component).fileId)).filter(Boolean);
    const filter = linked.find((entry) => entry?.type === 'MeshFilter');
    const renderer = linked.find((entry) => entry?.type === 'MeshRenderer');
    const mesh = filter ? reference(filter.data.m_Mesh) : undefined;
    const materials =
      renderer && Array.isArray(renderer.data.m_Materials) ? renderer.data.m_Materials.map(reference) : [];
    nodes.set(transform.id, {
      name: typeof gameObject.data.m_Name === 'string' ? gameObject.data.m_Name : '',
      transformId: transform.id,
      parentId: parent === '0' ? null : parent,
      position: vector(data.m_LocalPosition, ['x', 'y', 'z']) as [number, number, number],
      rotation: vector(data.m_LocalRotation, ['x', 'y', 'z', 'w']) as [number, number, number, number],
      scale: vector(data.m_LocalScale, ['x', 'y', 'z']) as [number, number, number],
      ...(mesh && mesh.fileId !== '0' ? { mesh } : {}),
      materials,
      active: gameObject.data.m_IsActive !== '0',
      rendererActive:
        !renderer || (renderer.data.m_Enabled !== '0' && (!lowerLods.has(renderer.id) || primaryLods.has(renderer.id))),
    });
  }
  for (const node of nodes.values()) {
    const seen = new Set([node.transformId]);
    let parent = node.parentId;
    while (parent) {
      if (seen.has(parent)) throw new Error(`cyclic Unity transform hierarchy at ${parent}`);
      seen.add(parent);
      const ancestor = nodes.get(parent);
      if (!ancestor) {
        if (options.allowExternalParents) break;
        throw new Error(`missing Unity parent transform ${parent}`);
      }
      parent = ancestor.parentId;
    }
  }
  return [...nodes.values()];
}
