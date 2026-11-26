import { resolveUnityHierarchy, type UnityMeshNode } from './hierarchy.js';
import { applyPrefabOverrides } from './overrides.js';
import type { UnityRecord } from './yaml.js';

type UnityObject = Record<string, unknown>;
function obj(value: unknown): UnityObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid Unity prefab instance');
  return value as UnityObject;
}
function id(value: unknown): string {
  const result = obj(value).fileID;
  if (typeof result !== 'string') throw new Error('invalid Unity prefab fileID');
  return result;
}

/** Expand YAML prefab instances into a scoped transform tree. Missing data fails closed. */
export function expandUnityInstances(
  source: Map<string, UnityRecord>,
  load: (guid: string) => Map<string, UnityRecord>,
): UnityMeshNode[] {
  const result: UnityMeshNode[] = [];
  const visit = (records: Map<string, UnityRecord>, scope: string, parent: string | null, stack: string[]) => {
    const aliases = new Map<string, string>();
    for (const record of records.values()) {
      if (!record.stripped || record.type !== 'Transform') continue;
      const instance = id(record.data.m_PrefabInstance);
      const original = id(record.data.m_CorrespondingSourceObject);
      aliases.set(record.id, `${scope}/${instance}/${original}`);
    }
    const scoped = (local: string) => aliases.get(local) ?? `${scope}/${local}`;
    for (const node of resolveUnityHierarchy(records, { allowExternalParents: true })) {
      result.push({
        ...node,
        transformId: scoped(node.transformId),
        parentId: node.parentId ? scoped(node.parentId) : parent,
      });
    }
    for (const instance of records.values()) {
      if (instance.type !== 'PrefabInstance') continue;
      const reference = obj(instance.data.m_SourcePrefab);
      const guid = reference.guid;
      if (typeof guid !== 'string' || !guid) throw new Error(`missing source prefab GUID for ${instance.id}`);
      if (stack.includes(guid)) throw new Error(`cyclic prefab reference ${guid}`);
      const modification = obj(instance.data.m_Modification);
      for (const field of ['m_RemovedComponents', 'm_RemovedGameObjects', 'm_AddedGameObjects', 'm_AddedComponents']) {
        const entries = modification[field];
        if (Array.isArray(entries) && entries.length) throw new Error(`unsupported prefab ${field}`);
      }
      const parentId = id(modification.m_TransformParent);
      const child = applyPrefabOverrides(load(guid), modification.m_Modifications ?? []);
      visit(child, `${scope}/${instance.id}`, parentId === '0' ? parent : scoped(parentId), [...stack, guid]);
    }
  };
  visit(source, 'root', null, []);
  const byId = new Map(result.map((node) => [node.transformId, node]));
  for (const node of result) {
    const seen = new Set([node.transformId]);
    let parent = node.parentId;
    while (parent) {
      if (seen.has(parent)) throw new Error(`cyclic Unity transform hierarchy at ${parent}`);
      seen.add(parent);
      const ancestor = byId.get(parent);
      if (!ancestor) throw new Error(`missing Unity parent transform ${parent}`);
      parent = ancestor.parentId;
    }
  }
  return result;
}
