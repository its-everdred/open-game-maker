import type { AssetLoader } from '@gm/sdk/assets';
import type { Mesh, Object3D } from 'three';

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
    node ??= object.userData.name === wanted || object.name === wanted ? object : undefined;
  });
  const meshes = node ? meshesUnder(node) : name ? [] : meshesUnder(root);
  if (meshes.length !== 1) {
    const found = node || !name ? `${meshes.length} meshes` : `no node named ${name}`;
    throw new Error(`Kit card ${cardId} needs exactly one mesh in ${file}, found ${found}`);
  }
  return meshes[0]!.clone();
}
