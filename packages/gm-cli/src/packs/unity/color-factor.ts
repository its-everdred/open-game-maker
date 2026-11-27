import type { ShaderGraphFactor } from './shadergraph.js';
import { compileUvAffine } from './uv-affine.js';

type GraphObject = Record<string, unknown>;
type Edge = { node: string; inputSlot: number; outputSlot: number };
function object(value: unknown): GraphObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid Unity shader graph');
  return value as GraphObject;
}
function nodeId(value: unknown): string {
  const id = object(value).m_Id;
  if (typeof id !== 'string') throw new Error('invalid Unity shader graph node ID');
  return id;
}

/** A null material texture with Shader Graph's black mode has zero RGB. */
export function hasBlackRgbFallback(
  id: string,
  byId: Map<string, GraphObject>,
  incoming: Map<string, Edge[]>,
  textures?: ReadonlyMap<string, unknown>,
): boolean {
  const node = byId.get(id);
  const inputs = incoming.get(id) ?? [];
  if (
    !textures ||
    node?.m_Type !== 'UnityEditor.ShaderGraph.SampleTexture2DNode' ||
    node.m_TextureType !== 0 ||
    inputs.some((input) => ![1, 2].includes(input.inputSlot)) ||
    new Set(inputs.map((input) => input.inputSlot)).size !== inputs.length
  )
    return false;
  const texture = inputs.find((input) => input.inputSlot === 1);
  if (!texture || texture.outputSlot !== 0) return false;
  const uv = inputs.find((input) => input.inputSlot === 2);
  if (uv) {
    const node = byId.get(uv.node);
    const channel = node?.m_OutputChannel ?? 0;
    if (
      node?.m_Type !== 'UnityEditor.ShaderGraph.UVNode' ||
      uv.outputSlot !== 0 ||
      !Number.isInteger(channel) ||
      (channel as number) < 0 ||
      (channel as number) > 7 ||
      (incoming.get(uv.node) ?? []).length
    )
      return false;
  }
  const source = byId.get(texture.node);
  if (source?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode' || (incoming.get(texture.node) ?? []).length)
    return false;
  const property = byId.get(nodeId(source.m_Property));
  const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
  if (
    property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.Texture2DShaderProperty' ||
    property.m_DefaultType !== 1 ||
    property.m_Modifiable !== true ||
    property.m_GeneratePropertyBlock !== true ||
    typeof key !== 'string' ||
    !key
  )
    return false;
  const saved = textures.get(key);
  if (saved === undefined) return false;
  const reference = object(object(saved).m_Texture);
  return !reference.guid && String(reference.fileID) === '0';
}

/** Resolve scalar properties and verified unassigned white texture slots. */
export function createScalarFactor(
  byId: Map<string, GraphObject>,
  incoming: Map<string, Edge[]>,
  floats: ReadonlyMap<string, unknown>,
  colors: ReadonlyMap<string, unknown>,
  textures?: ReadonlyMap<string, unknown>,
): (edge: { node: string; outputSlot: number }) => ShaderGraphFactor {
  const scalarFactor = (edge: { node: string; outputSlot: number }, seen = new Set<string>()): ShaderGraphFactor => {
    if (seen.has(edge.node)) throw new Error('cyclic Unity color adjustment');
    const next = new Set(seen).add(edge.node);
    const node = byId.get(edge.node);
    const inputs = incoming.get(edge.node) ?? [];
    if (
      node?.m_Type === 'UnityEditor.ShaderGraph.OneMinusNode' &&
      edge.outputSlot === 1 &&
      inputs.length === 1 &&
      inputs[0]!.inputSlot === 0
    ) {
      const inner = scalarFactor(inputs[0]!, next);
      if (inner.kind !== 'constant' || typeof inner.defaultValue !== 'number')
        throw new Error('unsupported Unity color adjustment amount');
      return { key: '', kind: 'constant', defaultValue: 1 - inner.defaultValue };
    }
    if (
      node?.m_Type === 'UnityEditor.ShaderGraph.SampleTexture2DNode' &&
      [4, 5, 6, 7].includes(edge.outputSlot) &&
      textures
    ) {
      const unsupported = () => new Error('unsupported Unity color adjustment amount');
      if (
        node.m_TextureType !== 0 ||
        inputs.some((input) => input.inputSlot !== 2) ||
        inputs.length > 1 ||
        !Array.isArray(node.m_Slots)
      )
        throw unsupported();
      const slots = node.m_Slots
        .map((slot) => byId.get(nodeId(slot)))
        .filter((slot) => slot?.m_Id === 1 && slot.m_SlotType === 0);
      if (
        slots.length !== 1 ||
        slots[0]!.m_Type !== 'UnityEditor.ShaderGraph.Texture2DInputMaterialSlot' ||
        slots[0]!.m_DefaultType !== 0
      )
        throw unsupported();
      const texture = object(slots[0]!.m_Texture);
      if (texture.m_Guid !== '' || typeof texture.m_SerializedTexture !== 'string') throw unsupported();
      let serialized: GraphObject;
      try {
        serialized = object(object(JSON.parse(texture.m_SerializedTexture)).texture);
      } catch {
        throw unsupported();
      }
      if (serialized.guid || String(serialized.instanceID ?? serialized.fileID) !== '0') throw unsupported();
      const saved = textures.get(`_SampleTexture2D_${edge.node}_Texture_1`);
      if (saved === undefined) throw unsupported();
      const reference = object(object(saved).m_Texture);
      if (reference.guid || String(reference.fileID) !== '0') throw unsupported();
      if (inputs.length) compileUvAffine(inputs[0]!, byId, incoming, floats, colors, next);
      return { key: '', kind: 'constant', defaultValue: 1 };
    }
    if (node?.m_Type === 'UnityEditor.ShaderGraph.SplitNode' && edge.outputSlot >= 1 && edge.outputSlot <= 4) {
      if (inputs.length !== 1 || inputs[0]!.inputSlot !== 0 || inputs[0]!.outputSlot !== 0)
        throw new Error('unsupported Unity color adjustment component');
      const source = byId.get(inputs[0]!.node);
      if (source?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode' || (incoming.get(inputs[0]!.node) ?? []).length)
        throw new Error('unsupported Unity color adjustment component');
      const property = byId.get(nodeId(source.m_Property));
      const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
      const channel = edge.outputSlot - 1;
      if (
        property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.ColorShaderProperty' ||
        typeof key !== 'string' ||
        !key
      )
        throw new Error('unsupported Unity color adjustment property');
      const value = Number(object(property.m_Value)[['r', 'g', 'b', 'a'][channel]!]);
      if (!Number.isFinite(value)) throw new Error('invalid Unity color adjustment property');
      if (property.m_ColorMode !== undefined && property.m_ColorMode !== 0) {
        const selected = Number(object(colors.get(key) ?? property.m_Value)[['r', 'g', 'b', 'a'][channel]!]);
        if (property.m_ColorMode !== 1 || ![1, 3].includes(Number(property.m_SGVersion)) || !Number.isFinite(selected))
          throw new Error('unsupported Unity color adjustment property');
        return { key: '', kind: 'constant', defaultValue: selected };
      }
      return { key, kind: 'component', channel, defaultValue: value };
    }
    if (node?.m_Type === 'UnityEditor.ShaderGraph.PropertyNode' && edge.outputSlot === 0 && !inputs.length) {
      const property = byId.get(nodeId(node.m_Property));
      const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
      if (
        property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty' ||
        typeof key !== 'string' ||
        !key ||
        typeof property.m_Value !== 'number' ||
        !Number.isFinite(property.m_Value)
      )
        throw new Error('unsupported Unity color adjustment property');
      return { key, kind: 'scalar', defaultValue: property.m_Value };
    }
    if (node?.m_Type === 'UnityEditor.ShaderGraph.Vector1Node' && edge.outputSlot === 0 && !inputs.length) {
      const slots = Array.isArray(node.m_Slots) ? node.m_Slots.map((slot) => byId.get(nodeId(slot))) : [];
      const matches = slots.filter((slot) => slot?.m_Id === 1 && slot.m_SlotType === 0);
      if (node.m_Slots !== undefined && matches.length !== 1)
        throw new Error('invalid Unity color adjustment constant');
      const value = matches.length ? matches[0]!.m_Value : node.m_Value;
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error('invalid Unity color adjustment constant');
      return { key: '', kind: 'constant', defaultValue: value };
    }
    throw new Error(
      `unsupported Unity color adjustment amount: ${String(node?.m_Type)} output ${edge.outputSlot} at ${edge.node}`,
    );
  };
  return scalarFactor;
}
