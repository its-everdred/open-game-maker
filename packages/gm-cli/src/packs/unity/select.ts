import type { UnityMeshNode } from './hierarchy.js';

/** Keep the named object, its descendants and its transform-only ancestors. */
export function selectUnityBuilding(nodes: UnityMeshNode[], name: string): UnityMeshNode[] {
  const byExactId = nodes.filter((node) => node.transformId === name);
  const matches = byExactId.length ? byExactId : nodes.filter((node) => node.name === name);
  if (matches.length !== 1) throw new Error(`building object ${JSON.stringify(name)} is missing or ambiguous`);
  const byId = new Map(nodes.map((node) => [node.transformId, node]));
  const selected = new Set([matches[0]!.transformId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && selected.has(node.parentId) && !selected.has(node.transformId)) {
        selected.add(node.transformId);
        changed = true;
      }
    }
  }
  const ancestors = new Set<string>();
  let parent = matches[0]!.parentId;
  while (parent) {
    if (ancestors.has(parent)) throw new Error('cyclic Unity ancestor hierarchy');
    ancestors.add(parent);
    const node = byId.get(parent);
    if (!node) throw new Error(`missing Unity parent transform ${parent}`);
    parent = node.parentId;
  }
  return nodes
    .filter((node) => selected.has(node.transformId) || ancestors.has(node.transformId))
    .map((node) => {
      if (!ancestors.has(node.transformId)) return node;
      const transform = { ...node, materials: [], rendererActive: false };
      delete transform.mesh;
      delete transform.skinnedRendererActive;
      return transform;
    });
}

/** Combine explicitly identified scene pieces without including meshes on shared ancestors. */
export function selectUnityPieces(nodes: UnityMeshNode[], ids: string[]): UnityMeshNode[] {
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('scene piece IDs must be nonempty and unique');
  const byId = new Map(nodes.map((node) => [node.transformId, node]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.transformId]);
  }
  const selected = new Set<string>();
  const ancestors = new Set<string>();
  for (const id of ids) {
    const piece = byId.get(id);
    if (!piece) throw new Error(`scene piece ID ${JSON.stringify(id)} is missing`);
    let parent = piece.parentId;
    const seen = new Set([id]);
    while (parent) {
      if (seen.has(parent)) throw new Error('cyclic Unity ancestor hierarchy');
      seen.add(parent);
      const node = byId.get(parent);
      if (!node) throw new Error(`missing Unity parent transform ${parent}`);
      ancestors.add(parent);
      parent = node.parentId;
    }
  }
  const pending = [...ids];
  while (pending.length) {
    const id = pending.pop()!;
    if (selected.has(id)) continue;
    selected.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return nodes
    .filter((node) => selected.has(node.transformId) || ancestors.has(node.transformId))
    .map((node) => {
      if (selected.has(node.transformId)) return node;
      const transform = { ...node, materials: [], rendererActive: false };
      delete transform.mesh;
      delete transform.skinnedRendererActive;
      return transform;
    });
}
