import { parseUnityYaml } from './yaml.js';
import type { ShaderGraphBase } from './shadergraph.js';
import { mapWeightExpression, type WeightExpression } from './weight-expression.js';

export type UnityTexture = { guid: string; scale: [number, number]; offset: [number, number]; uv?: number };
export type UnitySurface = {
  textures: UnityTexture[];
  color: [number, number, number, number];
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

/** Return saved float properties for resolving material-specific graph switches. */
export function materialFloatProperties(source: string): Map<string, unknown> {
  return properties(object(material(source).m_SavedProperties).m_Floats);
}

/** Interpret standard base-color properties or explicit graph-resolved texture slots. */
export function parseUnitySurface(source: string, graph?: ShaderGraphBase): UnitySurface {
  const materialData = material(source);
  const saved = object(materialData.m_SavedProperties);
  const floats = properties(saved.m_Floats);
  const tags = object(materialData.stringTagMap ?? {});
  if (
    (tags.RenderType !== undefined && tags.RenderType !== 'Opaque') ||
    ['_AlphaClip', '_AlphaCutoffEnable', '_SurfaceType'].some((key) => floats.has(key) && Number(floats.get(key)) !== 0)
  ) {
    throw new Error('unsupported transparent or alpha-clipped Unity material');
  }
  const environments = properties(saved.m_TexEnvs);
  const colors = properties(saved.m_Colors);
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
    const textures = keys.map((key, index) => {
      const env = object(environments.get(key));
      const reference = object(env.m_Texture);
      if (typeof reference.guid !== 'string') throw new Error(`missing Unity texture for ${key}`);
      return {
        guid: reference.guid,
        scale: vector(env.m_Scale, ['x', 'y'], [1, 1]) as [number, number],
        offset: vector(env.m_Offset, ['x', 'y'], [0, 0]) as [number, number],
        ...(term?.textureChannels?.[index] ? { uv: term.textureChannels[index] } : {}),
      };
    });
    const color = (
      term ? [1, 1, 1, 1] : vector(colors.get('_BaseColor') ?? colors.get('_Color'), ['r', 'g', 'b', 'a'], [1, 1, 1, 1])
    ) as [number, number, number, number];
    for (const factor of term?.factors ?? []) {
      const value =
        factor.kind === 'constant'
          ? factor.defaultValue
          : factor.kind === 'scalar'
            ? Number(floats.get(factor.key) ?? factor.defaultValue)
            : vector(colors.get(factor.key), ['r', 'g', 'b', 'a'], factor.defaultValue as number[]);
      for (let index = 0; index < 4; index++)
        color[index] = color[index]! * (typeof value === 'number' ? value : value[index]!);
    }
    if (color.some((value) => !Number.isFinite(value) || value < 0 || value > 1))
      throw new Error('unsupported Unity base color factor');
    return {
      textures,
      color,
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
  return resolve(graph);
}
