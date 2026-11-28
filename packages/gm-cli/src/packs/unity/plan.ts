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
import { shaderGraphAlpha, shaderGraphClipThreshold } from './shader-alpha.js';
import { shaderGraphEmission } from './shader-emission.js';
import { fresnelFrontAlpha } from './fresnel-alpha.js';
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

async function loadUnityHierarchy(
  root: string,
  source: string,
  onWarning?: (message: string) => void,
  binary2text?: string,
): Promise<{
  nodes: UnityMeshNode[];
  index: Map<string, string>;
  file: (ref: UnityReference, extension: string | string[]) => string;
}> {
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
  return { nodes, index, file };
}

/** List selectable scoped transforms without resolving or exporting materials. */
export async function inspectUnityAssembly(
  root: string,
  source: string,
  binary2text?: string,
  onWarning?: (message: string) => void,
): Promise<UnityMeshNode[]> {
  return (await loadUnityHierarchy(root, source, onWarning, binary2text)).nodes;
}

/** Build a complete, checked local input plan before invoking any model converter. */
export async function planUnityAssembly(
  root: string,
  source: string,
  onWarning?: (message: string) => void,
  objectName?: string,
  binary2text?: string,
  pieceIds?: string[],
): Promise<PlannedUnityMesh[]> {
  const { nodes, index, file } = await loadUnityHierarchy(root, source, onWarning, binary2text);
  const selected = pieceIds
    ? selectUnityPieces(nodes, pieceIds)
    : objectName
      ? selectUnityBuilding(nodes, objectName)
      : nodes;
  const byId = new Map(selected.map((node) => [node.transformId, node]));
  const warnedClip = new Set<string>();
  const warnedEmission = new Set<string>();
  const warnedFresnel = new Set<string>();
  const surfaceCache = new Map<string, PlannedUnitySurface>();
  const visible = (node: UnityMeshNode): boolean => {
    let current: UnityMeshNode | undefined = node;
    while (current) {
      if (!current.active) return false;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  };
  return selected.map((node) => {
    if (node.skinnedRendererActive && visible(node)) throw new Error('unsupported Unity skinned mesh');
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
      const cached = surfaceCache.get(path);
      if (cached) return cached;
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
          const additive =
            materialIsTransparent(contents) &&
            Number(floats.get('_BlendMode')) === 1 &&
            Number(floats.get('_SrcBlend')) === 1 &&
            Number(floats.get('_DstBlend')) === 1;
          const approximateAlpha = materialIsTransparent(contents)
            ? fresnelFrontAlpha(shaderSource, floats)
            : undefined;
          if (approximateAlpha && !warnedFresnel.has(path)) {
            warnedFresnel.add(path);
            onWarning?.(`view-dependent opacity approximated by the front-facing value: ${path}`);
          }
          surface = parseUnitySurface(
            contents,
            additive
              ? shaderGraphEmission(shaderSource, loadSubgraph, floats, colors, textures)
              : shaderGraphBase(inlineUnitySubgraphs(shaderSource, loadSubgraph), floats, colors, textures),
            materialIsTransparent(contents)
              ? (approximateAlpha ?? shaderGraphAlpha(shaderSource, loadSubgraph, floats, colors, textures))
              : undefined,
            Number(floats.get('_AlphaClip') ?? floats.get('_BUILTIN_AlphaClip') ?? 0) === 1
              ? shaderGraphClipThreshold(shaderSource)
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
          file({ fileId: '0', guid: texture.guid }, ['.png', '.jpg', '.jpeg', '.tga', '.tif', '.tiff', '.bmp']),
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
        const constantOpacity =
          !mask &&
          !surface.opacity.textures.length &&
          !surface.opacity.products &&
          !surface.opacity.blends &&
          !surface.opacity.adjustment &&
          surface.opacity.color.every((value) => value === surface.opacity!.color[0] && value >= 0 && value <= 1);
        if (
          !constantOpacity &&
          (!mask ||
            typeof mask === 'number' ||
            'normal' in mask ||
            'vertexColor' in mask ||
            'noise' in mask ||
            'op' in mask ||
            ![0, 3].includes(mask.channel as number) ||
            mask.term.textures.length !== 1)
        )
          throw new Error(`material ${path}: unsupported Unity opacity graph`);
        if (!constantOpacity && mask && typeof mask !== 'number' && 'term' in mask) {
          const texturePath = file({ fileId: '0', guid: mask.term.textures[0]!.guid }, [
            '.png',
            '.tga',
            '.tif',
            '.tiff',
            '.bmp',
          ]);
          if (mask.channel === 3 && !textureHasSourceAlpha(readFileSync(`${texturePath}.meta`, 'utf8')))
            throw new Error(`material ${path}: unsupported Unity opacity texture alpha`);
        }
      }
      if (surface.alphaCutoff !== undefined && !warnedClip.has(path)) {
        warnedClip.add(path);
        onWarning?.(`alpha clipping approximated per texel for ${path}; inspect filtered edges and alpha-to-coverage`);
      }
      if (surface.additiveEmission && !warnedEmission.has(path)) {
        warnedEmission.add(path);
        onWarning?.(
          `additive emission approximated with alpha blending and clipped brightness for ${path}; inspect overlapping effects`,
        );
      }
      const planned = resolveSurface(surface);
      surfaceCache.set(path, planned);
      return planned;
    });
    return { ...node, ...(model ? { model } : {}), surfaces };
  });
}
