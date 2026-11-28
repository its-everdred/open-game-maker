import { parseUnityYaml } from './yaml.js';
import type { ShaderGraphBase, ShaderGraphFactor } from './shadergraph.js';
import type { WorldUv } from './world-uv.js';
import { mapWeightExpression, type WeightExpression } from './weight-expression.js';

export type UnityTexture = {
  guid: string;
  scale: [number, number];
  offset: [number, number];
  uv?: number;
  uvTransform?: [number, number, number, number, number, number];
  worldUvTransform?: WorldUv;
};
export type UnitySurface = {
  textures: UnityTexture[];
  color: [number, number, number, number];
  opacity?: UnitySurface;
  alphaCutoff?: number;
  additiveEmission?: boolean;
  doubleSided?: boolean;
  products?: UnitySurface[];
  scalarMask?: WeightExpression<UnitySurface>;
  adjustment?: { op: 'power' | 'saturation' | 'contrast'; amount: number };
  blends?: Array<{
    a: UnitySurface;
    b: UnitySurface;
    weight: WeightExpression<UnitySurface>;
  }>;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid Unity material property');
  return value as Record<string, unknown>;
}
function properties(value: unknown): Map<string, unknown> {
  if (!Array.isArray(value)) return new Map();
  return new Map(value.flatMap((entry) => Object.entries(object(entry))));
}
function vector(value: unknown, keys: string[], defaults: number[]): number[] {
  if (value === undefined) return defaults;
  const fields = object(value);
  return keys.map((key, index) => {
    const number = fields[key] === undefined ? defaults[index]! : Number(fields[key]);
    if (!Number.isFinite(number)) throw new Error(`invalid Unity material ${key}`);
    return number;
  });
}
function material(source: string): Record<string, unknown> {
  const materials = [...parseUnityYaml(source).values()].filter((record) => record.type === 'Material');
  if (materials.length !== 1) throw new Error('Unity material must contain exactly one Material record');
  return materials[0]!.data;
}
export function materialShaderGuid(source: string): string | undefined {
  const shader = object(material(source).m_Shader ?? {});
  return typeof shader.guid === 'string' ? shader.guid : undefined;
}

/** Report whether a material explicitly requests transparent rendering. */
export function materialIsTransparent(source: string): boolean {
  return object(material(source).stringTagMap ?? {}).RenderType === 'Transparent';
}

/** Return saved float properties for resolving material-specific graph switches. */
export function materialFloatProperties(source: string): Map<string, unknown> {
  return properties(object(material(source).m_SavedProperties).m_Floats);
}

/** Return saved vector and color properties used by material-specific UV graphs. */
export function materialColorProperties(source: string): Map<string, unknown> {
  return properties(object(material(source).m_SavedProperties).m_Colors);
}

/** Return saved texture environments when resolving Unity texture defaults. */
export function materialTextureProperties(source: string): Map<string, unknown> {
  return properties(object(material(source).m_SavedProperties).m_TexEnvs);
}

/** Interpret standard base-color properties or explicit graph-resolved texture slots. */
export function parseUnitySurface(
  source: string,
  graph?: ShaderGraphBase,
  alpha?: ShaderGraphBase,
  clip?: number,
): UnitySurface {
  const materialData = material(source);
  const saved = object(materialData.m_SavedProperties);
  const floats = properties(saved.m_Floats);
  const tags = object(materialData.stringTagMap ?? {});
  const transparent = tags.RenderType === 'Transparent';
  const additive =
    transparent &&
    Number(floats.get('_BlendMode')) === 1 &&
    Number(floats.get('_SrcBlend')) === 1 &&
    Number(floats.get('_DstBlend')) === 1;
  const clipEnabled =
    Number(floats.get('_AlphaClip') ?? floats.get('_BUILTIN_AlphaClip') ?? 0) === 1 &&
    Number(floats.get('_AlphaCutoffEnable') ?? 0) === 1;
  const clipSupported =
    transparent && clipEnabled && clip !== undefined && Number.isFinite(clip) && clip >= 0 && clip <= 1;
  const supportsTransparent =
    transparent &&
    alpha &&
    Number(floats.get('_SurfaceType')) === 1 &&
    (Number(floats.get('_BlendMode')) === 0 || additive) &&
    Number(floats.get('_SrcBlend')) === 1 &&
    (Number(floats.get('_DstBlend')) === 10 || additive) &&
    [0, 1].includes(Number(floats.get('_DoubleSidedEnable')));
  if (
    (transparent ? !supportsTransparent : tags.RenderType !== undefined && tags.RenderType !== 'Opaque') ||
    (['_AlphaClip', '_BUILTIN_AlphaClip', '_AlphaCutoffEnable'].some(
      (key) => floats.has(key) && Number(floats.get(key)) !== 0,
    ) &&
      !clipSupported) ||
    (!transparent && floats.has('_SurfaceType') && Number(floats.get('_SurfaceType')) !== 0)
  ) {
    throw new Error('unsupported transparent or alpha-clipped Unity material');
  }
  const environments = properties(saved.m_TexEnvs);
  const colors = properties(saved.m_Colors);
  const resolveFactor = (factor: ShaderGraphFactor): number | number[] => {
    if (factor.kind === 'constant') return factor.defaultValue;
    if (factor.kind === 'scalar') return Number(floats.get(factor.key) ?? factor.defaultValue);
    if (factor.kind === 'component') {
      if (
        !Number.isInteger(factor.channel) ||
        factor.channel! < 0 ||
        factor.channel! > 3 ||
        typeof factor.defaultValue !== 'number'
      )
        throw new Error('invalid Unity color adjustment component');
      return vector(colors.get(factor.key), ['r', 'g', 'b', 'a'], Array(4).fill(factor.defaultValue))[factor.channel!]!;
    }
    return vector(colors.get(factor.key), ['r', 'g', 'b', 'a'], factor.defaultValue as number[]);
  };
  const standard = ['_BaseColorMap', '_BaseMap', '_MainTex'].find((key) => {
    const value = environments.get(key);
    return value !== undefined && typeof object(object(value).m_Texture).guid === 'string';
  });
  if (!standard && !graph && [...environments.keys()].some((key) => /_SampleTexture2D_/i.test(key))) {
    throw new Error('unsupported Unity shader graph texture properties');
  }
  const resolve = (term?: ShaderGraphBase): UnitySurface => {
    const keys = term?.textures ?? (standard ? [standard] : []);
    if (
      term?.textureChannels &&
      (term.textureChannels.length !== keys.length ||
        term.textureChannels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 7))
    )
      throw new Error('invalid Unity texture UV channels');
    if (
      term?.textureUvTransforms &&
      (term.textureUvTransforms.length !== keys.length ||
        term.textureUvTransforms.some(
          (transform, index) =>
            transform &&
            (transform.channel !== (term.textureChannels?.[index] ?? 0) ||
              transform.matrix.length !== 6 ||
              transform.matrix.some((value) => !Number.isFinite(value))),
        ))
    )
      throw new Error('invalid Unity texture UV transforms');
    if (
      term?.textureWorldTransforms &&
      (term.textureWorldTransforms.length !== keys.length ||
        term.textureWorldTransforms.some(
          (transform, index) =>
            transform &&
            (transform.length !== 8 ||
              transform.some((value) => !Number.isFinite(value)) ||
              term.textureUvTransforms?.[index] ||
              (term.textureChannels?.[index] ?? 0) !== 0),
        ))
    )
      throw new Error('invalid Unity texture world UV transforms');
    const textures = keys.map((key, index) => {
      const direct = /^unity-guid:([a-f0-9]{32})$/.exec(key);
      const env = direct ? { m_Texture: { guid: direct[1] } } : object(environments.get(key));
      const reference = object(env.m_Texture);
      if (typeof reference.guid !== 'string') throw new Error(`missing Unity texture for ${key}`);
      const scale = vector(env.m_Scale, ['x', 'y'], [1, 1]) as [number, number];
      const offset = vector(env.m_Offset, ['x', 'y'], [0, 0]) as [number, number];
      const transform = term?.textureUvTransforms?.[index];
      const worldTransform = term?.textureWorldTransforms?.[index];
      if (transform && (scale[0] !== 1 || scale[1] !== 1 || offset[0] !== 0 || offset[1] !== 0))
        throw new Error('unsupported texture property transform with explicit Unity UV graph');
      return {
        guid: reference.guid,
        scale,
        offset,
        ...(term?.textureChannels?.[index] ? { uv: term.textureChannels[index] } : {}),
        ...(transform ? { uvTransform: transform.matrix } : {}),
        ...(worldTransform ? { worldUvTransform: worldTransform } : {}),
      };
    });
    const color = (
      term ? [1, 1, 1, 1] : vector(colors.get('_BaseColor') ?? colors.get('_Color'), ['r', 'g', 'b', 'a'], [1, 1, 1, 1])
    ) as [number, number, number, number];
    for (const factor of term?.factors ?? []) {
      const value = resolveFactor(factor);
      for (let index = 0; index < 4; index++)
        color[index] = color[index]! * (typeof value === 'number' ? value : value[index]!);
    }
    if (color.some((value) => !Number.isFinite(value) || value < 0))
      throw new Error('unsupported Unity base color factor');
    const products = term?.products?.map(resolve);
    const scalarMask = term?.scalarMask !== undefined ? mapWeightExpression(term.scalarMask, resolve) : undefined;
    const validMask = (mask: WeightExpression<UnitySurface>): boolean => {
      if (typeof mask === 'number') return Number.isFinite(mask);
      if ('normal' in mask) return Number.isInteger(mask.normal) && mask.normal >= 0 && mask.normal <= 2;
      if ('vertexColor' in mask)
        return Number.isInteger(mask.vertexColor) && mask.vertexColor >= 0 && mask.vertexColor <= 3;
      if ('noise' in mask)
        return (
          Number.isInteger(mask.noise.uv) &&
          mask.noise.uv >= 0 &&
          mask.noise.uv <= 7 &&
          Number.isFinite(mask.noise.scale)
        );
      if ('op' in mask) return mask.args.every(validMask);
      return (
        mask.channel === 'rgb' ||
        (Number.isInteger(mask.channel) && (mask.channel as number) >= 0 && (mask.channel as number) <= 3)
      );
    };
    if (scalarMask !== undefined && !validMask(scalarMask)) throw new Error('invalid Unity scalar mask channel');
    const adjustment = term?.adjustment
      ? { op: term.adjustment.op, amount: resolveFactor(term.adjustment.amount) }
      : undefined;
    if (
      adjustment &&
      (typeof adjustment.amount !== 'number' ||
        !Number.isFinite(adjustment.amount) ||
        adjustment.amount < 0 ||
        (adjustment.op === 'power' && adjustment.amount === 0))
    )
      throw new Error(`unsupported Unity color adjustment amount: ${adjustment.op}=${String(adjustment.amount)}`);
    const unsafeMask = (mask: WeightExpression<UnitySurface>): boolean => {
      if (typeof mask === 'number') return mask < 0;
      if ('normal' in mask) return true;
      if ('vertexColor' in mask) return true;
      if ('noise' in mask) return true;
      if ('op' in mask) return !['add', 'multiply'].includes(mask.op) || mask.args.some(unsafeMask);
      return Boolean(mask.invert || containsBlend(mask.term));
    };
    const containsBlend = (surface: UnitySurface): boolean =>
      Boolean(
        surface.blends?.length ||
        (surface.adjustment?.op === 'contrast' && surface.adjustment.amount > 1) ||
        surface.products?.some(containsBlend) ||
        (surface.scalarMask !== undefined && unsafeMask(surface.scalarMask)),
      );
    if (adjustment?.op === 'power' && products?.some(containsBlend))
      throw new Error('unsupported Unity power input with blends');
    return {
      textures,
      color,
      ...(products ? { products } : {}),
      ...(scalarMask !== undefined ? { scalarMask } : {}),
      ...(adjustment ? { adjustment: adjustment as UnitySurface['adjustment'] } : {}),
      ...(term?.blends
        ? {
            blends: term.blends.map(({ a, b, weight }) => ({
              a: resolve(a),
              b: resolve(b),
              weight: mapWeightExpression(weight, resolve),
            })),
          }
        : {}),
    };
  };
  return {
    ...resolve(graph),
    ...(transparent && alpha
      ? { opacity: resolve(alpha), doubleSided: Number(floats.get('_DoubleSidedEnable')) === 1 }
      : {}),
    ...(clipSupported ? { alphaCutoff: clip } : {}),
    ...(additive ? { additiveEmission: true } : {}),
  };
}
