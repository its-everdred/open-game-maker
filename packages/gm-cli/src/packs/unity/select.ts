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
      return transform;
    });
}
