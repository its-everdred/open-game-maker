import type { AssetLoader } from '@gm/sdk/assets';
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, type Material, type Object3D } from 'three';
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
 * A float copy of `mesh`'s geometry in the decoded file's own space. `gm build assets` quantizes with meshopt, which
 * stores positions as normalized integers and puts the scale and offset that undo it on the card's node; baked in
 * here, the piece needs no transform of its own, so a game can set position and scale freely.
 */
function baked(mesh: Mesh, root: Object3D): BufferGeometry {
  const source = mesh.geometry;
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const { count, itemSize } = attribute;
    const values = new Float32Array(count * itemSize);
    for (let index = 0; index < count; index++) {
      for (let axis = 0; axis < itemSize; axis++) values[index * itemSize + axis] = attribute.getComponent(index, axis);
    }
    geometry.setAttribute(name, new BufferAttribute(values, itemSize));
  }
  if (source.index) geometry.setIndex(source.index.clone());
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  root.updateMatrixWorld(true);
  return geometry.applyMatrix4(new Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld));
}

/**
 * The card's meshes as one mesh with an identity transform. A card with several materials loads as one mesh per
 * material; they become one mesh with a material per group, so the card is still a single mesh (an `InstancedMesh` can
 * draw it too).
 */
function piece(meshes: Mesh[], root: Object3D, cardId: string): Mesh {
  if (meshes.length === 1) return new Mesh(baked(meshes[0]!, root), meshes[0]!.material);
  const parts = meshes.map((mesh) => baked(mesh, root));
  /* Parts may differ in which attributes they carry (one with UVs, one without); merging needs the same set. */
  const shared = Object.keys(parts[0]!.attributes).filter((name) => parts.every((part) => part.hasAttribute(name)));
  for (const part of parts) {
    for (const name of Object.keys(part.attributes)) if (!shared.includes(name)) part.deleteAttribute(name);
  }
  const geometry = mergeGeometries(parts, true);
  if (!geometry) throw new Error(`Kit card ${cardId} has parts with different vertex attributes`);
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  return new Mesh(
    geometry,
    meshes.map((mesh) => mesh.material as Material),
  );
}

/**
 * The mesh a kit card draws with, as a fresh clone (shared geometry and material, identity transform) so every
 * placement keeps its own transform.
 *
 * `gm build assets` packs every piece of a kit into one file, one node per card named by its id. three's glTF loader
 * strips `:`, `/` and `.` from node names and keeps the original in `userData.name`, so looking a card id up by name
 * misses and the file's first mesh comes back instead: every card of the pack draws the same piece. A card with its
 * own file is that file's only mesh (`gm build assets` names the glTF mesh, not the node, after the card there); a file
 * with several meshes and no node for the card is refused with the card named.
 */
export async function kitPiece(loader: AssetLoader, cardId: string): Promise<Mesh> {
  const { file, mesh: name } = loader.resolve(cardId);
  /*
   * `loader.mesh` decodes and caches the file; the mesh it returns sits in that decoded scene unless a game has moved
   * it into its own scene, so games take every kit card through `kitPiece`.
   */
  let root: Object3D = await loader.mesh(cardId);
  while (root.parent) root = root.parent;

  const wanted = name ?? cardId;
  let node: Object3D | undefined;
  root.traverse((object) => {
    node ??= object.userData.name === wanted ? object : undefined;
  });
  const owner = node ?? root;
  let cached = pieces.get(owner);
  if (!cached) {
    const meshes = meshesUnder(owner);
    if (meshes.length === 0) throw new Error(`Kit card ${cardId} has no mesh`);
    if (!node && meshes.length !== 1) {
      if (name) throw new Error(`Kit card ${cardId} has no node named ${name} in ${file}`);
      throw new Error(`Kit card ${cardId} needs exactly one mesh in ${file}, found ${meshes.length}`);
    }
    cached = piece(meshes, root, cardId);
    pieces.set(owner, cached);
  }
  return cached.clone();
}
