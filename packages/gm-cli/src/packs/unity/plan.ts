import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, sep } from 'node:path';
import { indexUnityGuids } from './guid-index.js';
import { expandUnityInstances } from './instances.js';
import { meshNameFromMeta } from './model-meta.js';
import { parseUnityYaml } from './yaml.js';
import type { UnityMeshNode, UnityReference } from './hierarchy.js';

export type PlannedUnityMesh = UnityMeshNode & {
  model?: { path: string; name: string };
  materialPaths: string[];
};

/** Build a complete, checked local input plan before invoking any model converter. */
export async function planUnityAssembly(root: string, source: string): Promise<PlannedUnityMesh[]> {
  const canonicalRoot = realpathSync(root);
  const canonicalSource = realpathSync(source);
  const fromRoot = relative(canonicalRoot, canonicalSource);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('Unity source is outside its indexed root');
  }
  const index = await indexUnityGuids(canonicalRoot);
  function file(ref: UnityReference, extension: string): string {
    if (!ref.guid) throw new Error(`Unity reference ${ref.fileId} has no GUID`);
    const path = index.get(ref.guid.toLowerCase());
    if (!path || extname(path).toLowerCase() !== extension)
      throw new Error(`missing Unity ${extension} GUID ${ref.guid}`);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`invalid Unity asset ${ref.guid}`);
    return path;
  }
  const scene = parseUnityYaml(readFileSync(canonicalSource, 'utf8'));
  const nodes = expandUnityInstances(scene, (guid) => {
    const path = file({ fileId: '0', guid }, '.prefab');
    return parseUnityYaml(readFileSync(path, 'utf8'));
  });
  return nodes.map((node) => {
    const modelPath = node.mesh ? file(node.mesh, '.fbx') : undefined;
    const model =
      modelPath && node.mesh
        ? { path: modelPath, name: meshNameFromMeta(readFileSync(`${modelPath}.meta`, 'utf8'), node.mesh.fileId) }
        : undefined;
    const materialPaths = node.materials.map((ref) => file(ref, '.mat'));
    return { ...node, ...(model ? { model } : {}), materialPaths };
  });
}
