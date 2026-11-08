import type { AssetLoader } from '@gm/sdk/assets';
import { Mesh, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true;
}

function meshesUnder(root: Object3D): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if (isMesh(object)) found.push(object);
  });
  return found;
}

/** One mesh per decoded card node, so every placement of a card shares its geometry. */
const pieces = new WeakMap<Object3D, Mesh>();

/**
 * A card with several materials loads as one mesh per material; they become one mesh with a material per group, so
 * the card is still a single mesh (an `InstancedMesh` can draw it too).
 */
function merged(meshes: Mesh[], cardId: string): Mesh {
  if (meshes.length === 0) throw new Error(`Kit card ${cardId} has no mesh`);
  if (meshes.length === 1) return meshes[0]!;
  const geometry = mergeGeometries(
    meshes.map((mesh) => mesh.geometry),
    true,
  );
  if (!geometry) throw new Error(`Kit card ${cardId} has parts with different vertex attributes`);
  return new Mesh(
    geometry,
    meshes.map((mesh) => mesh.material as Material),
  );
}

/**
 * The mesh a kit card draws with, as a fresh clone (shared geometry and material) so every placement keeps its own
 * transform.
 *
 * `gm build assets` packs every piece of a kit into one file, one node per card named by its id. three's glTF loader
 * strips `:`, `/` and `.` from node names and keeps the original in `userData.name`, so looking a card id up by name
 * misses and the file's first mesh comes back instead: every card of the pack draws the same piece. A card with its
 * own file (no `mesh` in the manifest) may be that file's only mesh; anything else is refused with the card named.
 */
export async function kitPiece(loader: AssetLoader, cardId: string): Promise<Mesh> {
  const { file, mesh: name } = loader.resolve(cardId);
  /* `loader.mesh` decodes and caches the file; whatever mesh it returns sits in that decoded scene. */
  let root: Object3D = await loader.mesh(cardId);
  while (root.parent) root = root.parent;

  const wanted = name ?? cardId;
  let node: Object3D | undefined;
  root.traverse((object) => {
    node ??= object.userData.name === wanted ? object : undefined;
  });
  if (node) {
    let piece = pieces.get(node);
    if (!piece) {
      piece = merged(meshesUnder(node), cardId);
      pieces.set(node, piece);
    }
    return piece.clone();
  }
  if (name) throw new Error(`Kit card ${cardId} has no node named ${name} in ${file}`);
  const meshes = meshesUnder(root);
  if (meshes.length !== 1) {
    throw new Error(`Kit card ${cardId} needs exactly one mesh in ${file}, found ${meshes.length}`);
  }
  return meshes[0]!.clone();
}
