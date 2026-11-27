import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, sep } from 'node:path';
import { indexUnityGuids } from './guid-index.js';
import { expandUnityInstances } from './instances.js';
import { meshNameFromMeta } from './model-meta.js';
import {
  materialColorProperties,
  materialFloatProperties,
  materialIsTransparent,
  materialTextureProperties,
  materialShaderGuid,
  parseUnitySurface,
  type UnitySurface,
} from './material.js';
import { shaderGraphBase } from './shadergraph.js';
import { shaderGraphAlpha } from './shader-alpha.js';
import { mapWeightExpression, type WeightExpression } from './weight-expression.js';
import { inlineUnitySubgraphs } from './subgraphs.js';
import { selectUnityBuilding, selectUnityPieces } from './select.js';
import { textureHasSourceAlpha, textureIsSrgb } from './texture-meta.js';
import { readUnityRecords } from './read.js';
import type { UnityMeshNode, UnityReference } from './hierarchy.js';

export type PlannedUnitySurface = Omit<UnitySurface, 'blends' | 'products' | 'scalarMask' | 'opacity'> & {
  path: string;
  texturePaths: string[];
  textureSrgb: boolean[];
  products?: PlannedUnitySurface[];
  scalarMask?: WeightExpression<PlannedUnitySurface>;
  opacity?: PlannedUnitySurface;
  blends?: Array<{
    a: PlannedUnitySurface;
    b: PlannedUnitySurface;
    weight: WeightExpression<PlannedUnitySurface>;
  }>;
};
export type PlannedUnityMesh = UnityMeshNode & {
  model?: { path: string; name: string };
  surfaces: PlannedUnitySurface[];
};

/** Build a complete, checked local input plan before invoking any model converter. */
export async function planUnityAssembly(
  root: string,
  source: string,
  onWarning?: (message: string) => void,
  objectName?: string,
  binary2text?: string,
  pieceIds?: string[],
): Promise<PlannedUnityMesh[]> {
  const canonicalRoot = realpathSync(root);
  const canonicalSource = realpathSync(source);
  const fromRoot = relative(canonicalRoot, canonicalSource);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('Unity source is outside its indexed root');
  }
  const index = await indexUnityGuids(canonicalRoot);
  function file(ref: UnityReference, extension: string | string[]): string {
    if (!ref.guid) throw new Error(`Unity reference ${ref.fileId} has no GUID`);
    const path = index.get(ref.guid.toLowerCase());
    const allowed = Array.isArray(extension) ? extension : [extension];
    if (!path || !allowed.includes(extname(path).toLowerCase()))
      throw new Error(`missing Unity ${allowed.join('/')} GUID ${ref.guid}`);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`invalid Unity asset ${ref.guid}`);
    return path;
  }
  const scene = readUnityRecords(canonicalSource, binary2text);
  const nodes = expandUnityInstances(
    scene,
    (guid) => {
      const path = file({ fileId: '0', guid }, '.prefab');
      return readUnityRecords(path, binary2text);
    },
    onWarning ? (guid, id, path) => onWarning(`stale override ${guid}:${id} ${path}`) : undefined,
  );
  const selected = pieceIds
    ? selectUnityPieces(nodes, pieceIds)
    : objectName
      ? selectUnityBuilding(nodes, objectName)
      : nodes;
  const byId = new Map(selected.map((node) => [node.transformId, node]));
  const visible = (node: UnityMeshNode): boolean => {
    let current: UnityMeshNode | undefined = node;
    while (current) {
      if (!current.active) return false;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  };
  return selected.map((node) => {
    if (!node.mesh || !node.rendererActive || !visible(node)) return { ...node, surfaces: [] };
    const modelPath = node.mesh ? file(node.mesh, '.fbx') : undefined;
    const model =
      modelPath && node.mesh
        ? {
            path: modelPath,
            name: meshNameFromMeta(
              readFileSync(`${modelPath}.meta`, 'utf8'),
              node.mesh.fileId,
              onWarning
                ? {
                    name: node.name,
                    onInferred: () =>
                      onWarning(
                        `mesh name inferred from object ${node.name} for ${node.mesh!.guid}:${node.mesh!.fileId}`,
                      ),
                  }
                : undefined,
            ),
          }
        : undefined;
    const surfaces = node.materials.map((ref) => {
      const path = file(ref, '.mat');
      const contents = readFileSync(path, 'utf8');
      const shaderGuid = materialShaderGuid(contents);
      const shaderPath = shaderGuid ? index.get(shaderGuid.toLowerCase()) : undefined;
      let surface: UnitySurface;
      if (shaderPath && extname(shaderPath).toLowerCase() === '.shadergraph') {
        const shader = file({ fileId: '0', guid: shaderGuid! }, '.shadergraph');
        try {
          const shaderSource = readFileSync(shader, 'utf8');
          const loadSubgraph = (guid: string) => readFileSync(file({ fileId: '0', guid }, '.shadersubgraph'), 'utf8');
          const floats = materialFloatProperties(contents);
          const colors = materialColorProperties(contents);
          const textures = materialTextureProperties(contents);
          surface = parseUnitySurface(
            contents,
            shaderGraphBase(inlineUnitySubgraphs(shaderSource, loadSubgraph), floats, colors, textures),
            materialIsTransparent(contents)
              ? shaderGraphAlpha(shaderSource, loadSubgraph, floats, colors, textures)
              : undefined,
          );
        } catch (error) {
          throw new Error(`material ${path}: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
          });
        }
      } else {
        if (shaderGuid && !/^0{16}[a-f0-9]{16}$/i.test(shaderGuid))
          throw new Error(`unsupported or missing Unity shader ${shaderGuid}`);
        surface = parseUnitySurface(contents);
      }
      const resolveSurface = (term: UnitySurface): PlannedUnitySurface => {
        const texturePaths = term.textures.map((texture) =>
          file({ fileId: '0', guid: texture.guid }, ['.png', '.jpg', '.jpeg', '.tga', '.tif', '.tiff']),
        );
        const textureSrgb = texturePaths.map((texturePath) =>
          textureIsSrgb(readFileSync(`${texturePath}.meta`, 'utf8')),
        );
        const { blends, products, scalarMask, opacity, ...base } = term;
        return {
          ...base,
          path,
          texturePaths,
          textureSrgb,
          ...(opacity ? { opacity: resolveSurface(opacity) } : {}),
          ...(products ? { products: products.map(resolveSurface) } : {}),
          ...(scalarMask !== undefined ? { scalarMask: mapWeightExpression(scalarMask, resolveSurface) } : {}),
          ...(blends
            ? {
                blends: blends.map(({ a, b, weight }) => ({
                  a: resolveSurface(a),
                  b: resolveSurface(b),
                  weight: mapWeightExpression(weight, resolveSurface),
                })),
              }
            : {}),
        };
      };
      if (surface.opacity) {
        const mask = surface.opacity.scalarMask;
        if (!mask || typeof mask === 'number' || 'op' in mask || mask.channel !== 3 || mask.term.textures.length !== 1)
          throw new Error(`material ${path}: unsupported Unity opacity graph`);
        const texturePath = file({ fileId: '0', guid: mask.term.textures[0]!.guid }, ['.png', '.tga', '.tif', '.tiff']);
        if (!textureHasSourceAlpha(readFileSync(`${texturePath}.meta`, 'utf8')))
          throw new Error(`material ${path}: unsupported Unity opacity texture alpha`);
      }
      return resolveSurface(surface);
    });
    return { ...node, ...(model ? { model } : {}), surfaces };
  });
}
