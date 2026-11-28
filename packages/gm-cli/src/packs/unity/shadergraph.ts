import { compileWeightExpression, type WeightExpression } from './weight-expression.js';
import { compileUvAffine, type UvAffine } from './uv-affine.js';
import { compileWorldUv, type WorldUv } from './world-uv.js';
import { createScalarFactor, hasBlackRgbFallback } from './color-factor.js';

type GraphObject = Record<string, unknown>;
function object(value: unknown): GraphObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid Unity shader graph');
  return value as GraphObject;
}
function nodeId(value: unknown): string {
  const id = object(value).m_Id;
  if (typeof id !== 'string') throw new Error('invalid Unity shader graph node ID');
  return id;
}

/** Shader Graph stores consecutive JSON objects instead of a single JSON document. */
export function shaderGraphDocuments(source: string): GraphObject[] {
  const result: GraphObject[] = [];
  let depth = 0,
    start = -1,
    inString = false,
    escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') {
      if (depth++ === 0) start = i;
    } else if (char === '}') {
      if (--depth < 0 || start < 0) throw new Error('invalid Unity shader graph JSON');
      if (depth === 0) {
        result.push(object(JSON.parse(source.slice(start, i + 1))));
        start = -1;
      }
    } else if (depth === 0 && !/\s/.test(char)) throw new Error('invalid Unity shader graph JSON');
  }
  if (depth !== 0 || inString || !result.length) throw new Error('invalid Unity shader graph JSON');
  return result;
}

export type ShaderGraphFactor = {
  key: string;
  kind: 'scalar' | 'color' | 'constant' | 'component';
  defaultValue: number | [number, number, number, number];
  channel?: number;
};
export type ShaderGraphBase = {
  textures: string[];
  textureChannels?: number[];
  textureUvTransforms?: Array<UvAffine | null>;
  textureWorldTransforms?: Array<WorldUv | null>;
  factors: ShaderGraphFactor[];
  products?: ShaderGraphBase[];
  scalarMask?: WeightExpression<ShaderGraphBase>;
  adjustment?: { op: 'power' | 'saturation' | 'contrast'; amount: ShaderGraphFactor };
  blends?: Array<{
    a: ShaderGraphBase;
    b: ShaderGraphBase;
    weight: WeightExpression<ShaderGraphBase>;
  }>;
};

function graphOutputSlot(node: GraphObject | undefined): number {
  switch (node?.m_Type) {
    case 'UnityEditor.ShaderGraph.MultiplyNode':
    case 'UnityEditor.ShaderGraph.PowerNode':
    case 'UnityEditor.ShaderGraph.SaturationNode':
    case 'UnityEditor.ShaderGraph.ContrastNode':
    case 'UnityEditor.ShaderGraph.BlendNode':
      return 2;
    case 'UnityEditor.ShaderGraph.BranchNode':
    case 'UnityEditor.ShaderGraph.LerpNode':
      return 3;
    case 'UnityEditor.ShaderGraph.SampleTexture2DNode':
    case 'UnityEditor.ShaderGraph.PropertyNode':
    case 'UnityEditor.ShaderGraph.ColorNode':
    case 'UnityEditor.ShaderGraph.Vector1Node':
      return 0;
    default:
      throw new Error(`unsupported Unity shader graph node ${String(node?.m_Type)}`);
  }
}

/** Resolve a base-color graph composed of texture samples, properties and multiplication. */
export function shaderGraphBase(
  source: string,
  floats: ReadonlyMap<string, unknown> = new Map(),
  colors: ReadonlyMap<string, unknown> = new Map(),
  textures?: ReadonlyMap<string, unknown>,
): ShaderGraphBase {
  const docs = shaderGraphDocuments(source);
  const graph = docs.find((doc) => doc.m_Type === 'UnityEditor.ShaderGraph.GraphData');
  const base = docs.find((doc) => doc.m_SerializedDescriptor === 'SurfaceDescription.BaseColor');
  if (!graph || !base || typeof base.m_ObjectId !== 'string' || !Array.isArray(graph.m_Edges)) {
    throw new Error('missing Unity shader graph base color');
  }
  const byId = new Map<string, GraphObject>();
  for (const doc of docs) {
    if (typeof doc.m_ObjectId !== 'string') continue;
    if (byId.has(doc.m_ObjectId)) throw new Error('duplicate Unity shader graph object ID');
    byId.set(doc.m_ObjectId, doc);
  }
  const incoming = new Map<string, Array<{ node: string; inputSlot: number; outputSlot: number }>>();
  for (const edge of graph.m_Edges) {
    const entry = object(edge);
    const input = object(entry.m_InputSlot);
    const output = object(entry.m_OutputSlot);
    const inputId = nodeId(input.m_Node);
    if (typeof input.m_SlotId !== 'number' || typeof output.m_SlotId !== 'number')
      throw new Error('invalid Unity shader graph slot');
    incoming.set(inputId, [
      ...(incoming.get(inputId) ?? []),
      { node: nodeId(output.m_Node), inputSlot: input.m_SlotId, outputSlot: output.m_SlotId },
    ]);
  }
  const scalarFactor = createScalarFactor(byId, incoming, floats, colors, textures);
  // Only RGB or a single RGB channel consumes this value; the unused alpha is
  // a placeholder because Unity versions disagree on black fallback alpha.
  const blackMask = (id: string, channel: number | 'rgb'): ShaderGraphBase | undefined =>
    channel !== 3 && hasBlackRgbFallback(id, byId, incoming, textures)
      ? { textures: [], factors: [{ key: '', kind: 'constant', defaultValue: [0, 0, 0, 1] }] }
      : undefined;
  const visit = (id: string, ancestors: Set<string>): ShaderGraphBase => {
    if (ancestors.has(id)) throw new Error('cyclic Unity shader graph');
    const node = byId.get(id);
    if (!node) throw new Error(`missing Unity shader node ${id}`);
    const type = node.m_Type;
    const inputs = incoming.get(id) ?? [];
    const resolveSource = (input: { node: string; outputSlot: number }): ShaderGraphBase => {
      const source = byId.get(input.node);
      if (source?.m_Type === 'UnityEditor.ShaderGraph.SplitNode')
        return { textures: [], factors: [scalarFactor(input)] };
      if (
        [
          'UnityEditor.ShaderGraph.ClampNode',
          'UnityEditor.ShaderGraph.AddNode',
          'UnityEditor.ShaderGraph.SubtractNode',
        ].includes(String(source?.m_Type))
      )
        return {
          textures: [],
          factors: [],
          scalarMask: compileWeightExpression(
            { ...input, inputSlot: 0 },
            byId,
            incoming,
            floats,
            (sample, seen, channel) => blackMask(sample, channel) ?? visit(sample, seen),
            new Set(ancestors).add(id),
            true,
          ),
        };
      if (source?.m_Type === 'UnityEditor.ShaderGraph.SampleTexture2DNode' && [4, 5, 6, 7].includes(input.outputSlot)) {
        if (source.m_TextureType !== undefined && source.m_TextureType !== 0)
          throw new Error('unsupported Unity texture sample type');
        if (blackMask(input.node, input.outputSlot - 4))
          return { textures: [], factors: [{ key: '', kind: 'constant', defaultValue: 0 }] };
        try {
          return { textures: [], factors: [scalarFactor(input)] };
        } catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith('unsupported Unity color adjustment amount'))
            throw error;
        }
        return {
          textures: [],
          factors: [],
          scalarMask: { term: visit(input.node, new Set(ancestors).add(id)), channel: input.outputSlot - 4 },
        };
      }
      if (input.outputSlot !== graphOutputSlot(source))
        throw new Error(
          `unsupported Unity shader graph output channel ${input.outputSlot} from ${String(source?.m_Type)} at ${input.node}`,
        );
      return visit(input.node, new Set(ancestors).add(id));
    };
    if (type === 'UnityEditor.ShaderGraph.Vector1Node' && inputs.length === 0) {
      const slots = Array.isArray(node.m_Slots) ? node.m_Slots.map((slot) => byId.get(nodeId(slot))) : [];
      const matches = slots.filter((slot) => slot?.m_Id === 1 && slot.m_SlotType === 0);
      if (node.m_Slots !== undefined && matches.length !== 1)
        throw new Error('invalid Unity shader graph constant slot');
      const input = matches[0];
      const value = input ? input.m_Value : node.m_Value;
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('invalid Unity shader graph constant');
      return { textures: [], factors: [{ key: '', kind: 'constant', defaultValue: value }] };
    }
    if (type === 'UnityEditor.ShaderGraph.ColorNode' && inputs.length === 0) {
      const colorState = object(node.m_Color);
      if (colorState.mode !== 0) throw new Error('unsupported Unity shader graph color mode');
      const value = object(colorState.color);
      const color = ['r', 'g', 'b', 'a'].map((key) => Number(value[key]));
      if (color.some((number) => !Number.isFinite(number))) throw new Error('invalid Unity shader graph color');
      for (let index = 0; index < 3; index++) {
        const channel = color[index]!;
        color[index] = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }
      return {
        textures: [],
        factors: [{ key: '', kind: 'constant', defaultValue: color as [number, number, number, number] }],
      };
    }
    if (type === 'UnityEditor.ShaderGraph.BlendNode') {
      if (
        (node.m_BlendMode !== 15 && node.m_BlendMode !== 19) ||
        inputs.length !== 2 ||
        !inputs.some((input) => input.inputSlot === 0) ||
        !inputs.some((input) => input.inputSlot === 1)
      )
        throw new Error('unsupported Unity color blend');
      const slots = Array.isArray(node.m_Slots) ? node.m_Slots.map((slot) => byId.get(nodeId(slot))) : [];
      const amount = slots.filter((slot) => slot?.m_Id === 3 && slot.m_SlotType === 0);
      if (amount.length !== 1 || typeof amount[0]!.m_Value !== 'number' || !Number.isFinite(amount[0]!.m_Value))
        throw new Error('unsupported Unity color blend amount');
      const a: WeightExpression<ShaderGraphBase> = {
        term: resolveSource(inputs.find((input) => input.inputSlot === 0)!),
        channel: 'rgb',
      };
      const b: WeightExpression<ShaderGraphBase> = {
        term: resolveSource(inputs.find((input) => input.inputSlot === 1)!),
        channel: 'rgb',
      };
      const result: WeightExpression<ShaderGraphBase> = {
        op: node.m_BlendMode === 15 ? 'overlay' : 'subtract',
        args: [a, b],
      };
      if (amount[0]!.m_Value === 0) return { textures: [], factors: [], scalarMask: a };
      if (amount[0]!.m_Value === 1) return { textures: [], factors: [], scalarMask: result };
      return {
        textures: [],
        factors: [],
        scalarMask: {
          op: 'add',
          args: [a, { op: 'multiply', args: [{ op: 'subtract', args: [result, a] }, amount[0]!.m_Value as number] }],
        },
      };
    }
    if (
      type === 'UnityEditor.ShaderGraph.PowerNode' ||
      type === 'UnityEditor.ShaderGraph.SaturationNode' ||
      type === 'UnityEditor.ShaderGraph.ContrastNode'
    ) {
      if (
        inputs.length !== 2 ||
        new Set(inputs.map((input) => input.inputSlot)).size !== 2 ||
        inputs.some((input) => ![0, 1].includes(input.inputSlot))
      )
        throw new Error('unsupported Unity color adjustment');
      const source = inputs.find((input) => input.inputSlot === 0)!;
      const amount = inputs.find((input) => input.inputSlot === 1)!;
      return {
        textures: [],
        factors: [],
        products: [resolveSource(source)],
        adjustment: {
          op:
            type === 'UnityEditor.ShaderGraph.PowerNode'
              ? 'power'
              : type === 'UnityEditor.ShaderGraph.SaturationNode'
                ? 'saturation'
                : 'contrast',
          amount: scalarFactor(amount),
        },
      };
    }
    if (type === 'UnityEditor.ShaderGraph.LerpNode') {
      if (!inputs.some((input) => input.inputSlot === 2)) {
        const slots = Array.isArray(node?.m_Slots) ? node.m_Slots.map((entry) => byId.get(nodeId(entry))) : [];
        const amountSlot = slots.find((slot) => slot?.m_Id === 2 && slot.m_SlotType === 0);
        const value = amountSlot?.m_Value;
        if (
          amountSlot?.m_Type === 'UnityEditor.ShaderGraph.DynamicVectorMaterialSlot' &&
          value &&
          typeof value === 'object' &&
          !Array.isArray(value)
        ) {
          const components = object(value);
          const amount = components.x;
          if ((amount === 0 || amount === 1) && ['y', 'z', 'w'].every((key) => components[key] === amount)) {
            const selected = inputs.filter((input) => input.inputSlot === amount);
            if (
              selected.length === 1 &&
              new Set(inputs.map((input) => input.inputSlot)).size === inputs.length &&
              inputs.every((input) => [0, 1].includes(input.inputSlot))
            )
              return resolveSource(selected[0]!);
          }
        }
      }
      if (
        !inputs.some((input) => input.inputSlot === 2) ||
        new Set(inputs.map((input) => input.inputSlot)).size !== inputs.length ||
        inputs.some((input) => ![0, 1, 2].includes(input.inputSlot))
      )
        throw new Error('unsupported Unity shader graph interpolation');
      const amount = inputs.find((input) => input.inputSlot === 2)!;
      const amountNode = byId.get(amount.node);
      const resolveInput = (slot: number) => {
        const input = inputs.find((entry) => entry.inputSlot === slot);
        if (!input) throw new Error('unsupported Unity shader graph interpolation input');
        return resolveSource(input);
      };
      type Mask = { term: ShaderGraphBase; channel: number; invert?: boolean };
      const maskFor = (edge: { node: string; outputSlot: number }, seen: Set<string>): Mask | undefined => {
        if (seen.has(edge.node)) throw new Error('cyclic Unity shader graph');
        const current = byId.get(edge.node);
        const next = new Set(seen).add(edge.node);
        if (current?.m_Type === 'UnityEditor.ShaderGraph.SampleTexture2DNode' && [4, 5, 6, 7].includes(edge.outputSlot))
          return {
            term: blackMask(edge.node, edge.outputSlot - 4) ?? visit(edge.node, seen),
            channel: edge.outputSlot - 4,
          };
        const linked = incoming.get(edge.node) ?? [];
        if (
          current?.m_Type === 'UnityEditor.ShaderGraph.OneMinusNode' &&
          edge.outputSlot === 1 &&
          linked.length === 1 &&
          linked[0]!.inputSlot === 0
        ) {
          const inner = maskFor(linked[0]!, next);
          return inner ? { ...inner, invert: !inner.invert } : undefined;
        }
        if (
          current?.m_Type === 'UnityEditor.ShaderGraph.MultiplyNode' &&
          edge.outputSlot === 2 &&
          linked.length === 2 &&
          new Set(linked.map((entry) => entry.inputSlot)).size === 2 &&
          linked.every((entry) => [0, 1].includes(entry.inputSlot))
        ) {
          for (const index of [0, 1]) {
            const factorEdge = linked[index]!;
            const factorNode = byId.get(factorEdge.node);
            if (factorEdge.outputSlot !== 0 || factorNode?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode') continue;
            const property = byId.get(nodeId(factorNode.m_Property));
            if (property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty') continue;
            const mask = maskFor(linked[1 - index]!, next);
            if (!mask || mask.invert) continue;
            const factor = visit(factorEdge.node, next);
            return { ...mask, term: { ...mask.term, factors: [...mask.term.factors, ...factor.factors] } };
          }
        }
        return undefined;
      };
      const mask = maskFor(amount, new Set(ancestors).add(id));
      if (mask)
        return { textures: [], factors: [], blends: [{ a: resolveInput(0), b: resolveInput(1), weight: mask }] };
      if (amountNode?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode') {
        const output = Array.isArray(amountNode?.m_Slots)
          ? amountNode.m_Slots
              .map((slot) => byId.get(nodeId(slot)))
              .find((slot) => slot?.m_Id === amount.outputSlot && slot.m_SlotType === 1)
          : undefined;
        const destination = Array.isArray(node.m_Slots)
          ? node.m_Slots.map((slot) => byId.get(nodeId(slot))).find((slot) => slot?.m_Id === 2 && slot.m_SlotType === 0)
          : undefined;
        const rgb =
          output?.m_Type === 'UnityEditor.ShaderGraph.Vector3MaterialSlot' &&
          ['UnityEditor.ShaderGraph.DynamicVectorMaterialSlot', 'UnityEditor.ShaderGraph.Vector3MaterialSlot'].includes(
            String(destination?.m_Type),
          );
        const weight = compileWeightExpression(
          amount,
          byId,
          incoming,
          floats,
          (sample, seen, channel) => blackMask(sample, channel) ?? visit(sample, seen),
          new Set(ancestors).add(id),
          rgb,
        );
        if (typeof weight === 'number' && (weight < 0 || weight > 1))
          throw new Error('unsupported Unity shader graph interpolation amount');
        return { textures: [], factors: [], blends: [{ a: resolveInput(0), b: resolveInput(1), weight }] };
      }
      if (
        amount.outputSlot !== 0 ||
        amountNode?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode' ||
        (incoming.get(amount.node) ?? []).length !== 0
      )
        throw new Error('unsupported Unity shader graph interpolation amount');
      const property = byId.get(nodeId(amountNode.m_Property));
      const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
      if (
        property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty' ||
        typeof key !== 'string' ||
        !key ||
        typeof property.m_Value !== 'number' ||
        !Number.isFinite(property.m_Value)
      )
        throw new Error('unsupported Unity shader graph interpolation property');
      const raw = floats.has(key) ? floats.get(key) : property.m_Value;
      if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '')
        throw new Error('unsupported Unity shader graph interpolation amount');
      const weight = Number(raw);
      if (!Number.isFinite(weight)) throw new Error('unsupported Unity shader graph interpolation amount');
      if (weight === 0 || weight === 1) return resolveInput(weight);
      const missing = [0, 1].filter((slot) => !inputs.some((input) => input.inputSlot === slot));
      if (missing.length === 1 && Array.isArray(node.m_Slots)) {
        const slots = node.m_Slots.map((entry) => byId.get(nodeId(entry)));
        const fallback = slots.filter((slot) => slot?.m_Id === missing[0] && slot.m_SlotType === 0);
        const output = slots.filter((slot) => slot?.m_Id === 3 && slot.m_SlotType === 1);
        const connected = inputs.find((input) => input.inputSlot === 1 - missing[0]!)!;
        const source = byId.get(connected.node);
        if (
          fallback.length !== 1 ||
          output.length !== 1 ||
          ![
            'UnityEditor.ShaderGraph.DynamicVectorMaterialSlot',
            'UnityEditor.ShaderGraph.Vector1MaterialSlot',
          ].includes(String(fallback[0]!.m_Type)) ||
          ![
            'UnityEditor.ShaderGraph.DynamicVectorMaterialSlot',
            'UnityEditor.ShaderGraph.Vector1MaterialSlot',
          ].includes(String(output[0]!.m_Type)) ||
          source?.m_Type !== 'UnityEditor.ShaderGraph.SampleTexture2DNode' ||
          ![4, 5, 6, 7].includes(connected.outputSlot)
        )
          throw new Error('unsupported Unity scalar interpolation input');
        const rawDefault = fallback[0]!.m_Value;
        const defaultValue = typeof rawDefault === 'number' ? rawDefault : object(rawDefault).x;
        if (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue))
          throw new Error('invalid Unity scalar interpolation default');
        const selected = resolveSource(connected);
        const constant =
          selected.textures.length === 0 &&
          !selected.products &&
          !selected.adjustment &&
          selected.factors.length === 1 &&
          selected.factors[0]!.kind === 'constant' &&
          typeof selected.factors[0]!.defaultValue === 'number'
            ? selected.factors[0]!.defaultValue
            : undefined;
        const expression = selected.scalarMask ?? constant;
        if (expression === undefined) throw new Error('unsupported Unity scalar interpolation input');
        const a: WeightExpression<ShaderGraphBase> = missing[0] === 0 ? defaultValue : expression;
        const b: WeightExpression<ShaderGraphBase> = missing[0] === 1 ? defaultValue : expression;
        return {
          textures: [],
          factors: [],
          scalarMask: { op: 'add', args: [a, { op: 'multiply', args: [{ op: 'subtract', args: [b, a] }, weight] }] },
        };
      }
      if (weight < 0 || weight > 1) throw new Error('unsupported Unity shader graph interpolation amount');
      return { textures: [], factors: [], blends: [{ a: resolveInput(0), b: resolveInput(1), weight }] };
    }
    if (type === 'UnityEditor.ShaderGraph.BranchNode') {
      if (
        inputs.length !== 3 ||
        new Set(inputs.map((input) => input.inputSlot)).size !== 3 ||
        inputs.some((input) => ![0, 1, 2].includes(input.inputSlot))
      )
        throw new Error('unsupported Unity shader graph branch');
      const selector = inputs.find((input) => input.inputSlot === 0)!;
      const selectorNode = byId.get(selector.node);
      if (
        selector.outputSlot !== 0 ||
        selectorNode?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode' ||
        (incoming.get(selector.node) ?? []).length !== 0
      )
        throw new Error('unsupported Unity shader graph branch selector');
      const property = byId.get(nodeId(selectorNode.m_Property));
      const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
      if (
        property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.BooleanShaderProperty' ||
        typeof key !== 'string' ||
        !key ||
        typeof property.m_Value !== 'boolean'
      )
        throw new Error('unsupported Unity shader graph branch property');
      const raw = floats.has(key) ? floats.get(key) : Number(property.m_Value);
      if (raw !== 0 && raw !== 1 && raw !== '0' && raw !== '1')
        throw new Error('invalid Unity shader graph branch value');
      const value = Number(raw);
      if (value !== 0 && value !== 1) throw new Error('invalid Unity shader graph branch value');
      const selected = inputs.find((input) => input.inputSlot === (value ? 1 : 2))!;
      const selectedNode = byId.get(selected.node);
      const outputSlot = graphOutputSlot(selectedNode);
      if (selected.outputSlot !== outputSlot) throw new Error('unsupported Unity shader graph output channel');
      return visit(selected.node, new Set(ancestors).add(id));
    }
    if (type === 'UnityEditor.ShaderGraph.SampleTexture2DNode') {
      if (
        inputs.some(
          (input) => ![1, 2].includes(input.inputSlot) || (input.inputSlot === 1 && input.outputSlot !== 0),
        ) ||
        new Set(inputs.map((input) => input.inputSlot)).size !== inputs.length
      )
        throw new Error(`unsupported Unity texture sample input at ${id}`);
      const uv = inputs.find((input) => input.inputSlot === 2);
      let uvChannel = 0;
      let uvTransform: UvAffine | undefined;
      let worldTransform: WorldUv | undefined;
      if (uv) {
        const uvNode = byId.get(uv.node);
        if (uvNode?.m_Type !== 'UnityEditor.ShaderGraph.UVNode') {
          try {
            uvTransform = compileUvAffine(uv, byId, incoming, floats, colors, new Set(ancestors).add(id));
            uvChannel = uvTransform.channel;
          } catch (error) {
            try {
              worldTransform = compileWorldUv(uv, byId, incoming, floats, colors, new Set(ancestors).add(id));
            } catch (worldError) {
              if (
                error instanceof Error &&
                error.message.includes('unsupported Unity UV node UnityEditor.ShaderGraph.PositionNode')
              )
                throw worldError;
              throw error;
            }
          }
        } else if (
          uv.outputSlot !== 0 ||
          (uvNode.m_OutputChannel !== undefined &&
            (!Number.isInteger(uvNode.m_OutputChannel) ||
              (uvNode.m_OutputChannel as number) < 0 ||
              (uvNode.m_OutputChannel as number) > 7))
        )
          throw new Error(`unsupported Unity texture UV graph at ${id}`);
        else uvChannel = (uvNode.m_OutputChannel as number | undefined) ?? 0;
      }
      const texture = inputs.find((input) => input.inputSlot === 1);
      if (!texture)
        return {
          textures: [`_SampleTexture2D_${id}_Texture_1`],
          factors: [],
          ...(uvChannel ? { textureChannels: [uvChannel] } : {}),
          ...(uvTransform ? { textureUvTransforms: [uvTransform] } : {}),
          ...(worldTransform ? { textureWorldTransforms: [worldTransform] } : {}),
        };
      const textureNode = byId.get(texture.node);
      if (textureNode?.m_Type === 'UnityEditor.ShaderGraph.Texture2DAssetNode' && texture.outputSlot === 0) {
        const asset = textureNode.m_Texture as { m_SerializedTexture?: unknown } | undefined;
        let guid: unknown;
        try {
          const reference = JSON.parse(String(asset?.m_SerializedTexture)) as {
            texture?: { guid?: unknown; fileID?: unknown };
          };
          if (reference.texture?.fileID === 2800000) guid = reference.texture.guid;
        } catch {
          throw new Error('invalid Unity texture asset reference');
        }
        if (typeof guid !== 'string' || !/^[a-f0-9]{32}$/i.test(guid))
          throw new Error('invalid Unity texture asset reference');
        return {
          textures: [`unity-guid:${guid.toLowerCase()}`],
          factors: [],
          ...(uvChannel ? { textureChannels: [uvChannel] } : {}),
          ...(uvTransform ? { textureUvTransforms: [uvTransform] } : {}),
          ...(worldTransform ? { textureWorldTransforms: [worldTransform] } : {}),
        };
      }
      if (textureNode?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode')
        throw new Error(`unsupported Unity texture property: ${String(textureNode?.m_Type)}`);
      const property = byId.get(nodeId(textureNode.m_Property));
      const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
      if (
        property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.Texture2DShaderProperty' ||
        typeof key !== 'string' ||
        !key
      )
        throw new Error('unsupported Unity texture property');
      return {
        textures: [key],
        factors: [],
        ...(uvChannel ? { textureChannels: [uvChannel] } : {}),
        ...(uvTransform ? { textureUvTransforms: [uvTransform] } : {}),
        ...(worldTransform ? { textureWorldTransforms: [worldTransform] } : {}),
      };
    }
    if (type === 'UnityEditor.ShaderGraph.PropertyNode' && inputs.length === 0) {
      const property = byId.get(nodeId(node.m_Property));
      if (!property) throw new Error('missing Unity shader graph property');
      const key = property.m_OverrideReferenceName || property.m_DefaultReferenceName;
      if (typeof key !== 'string' || !key) throw new Error('missing Unity shader graph property name');
      if (
        property.m_Type === 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty' &&
        typeof property.m_Value === 'number' &&
        Number.isFinite(property.m_Value)
      ) {
        return { textures: [], factors: [{ key, kind: 'scalar', defaultValue: property.m_Value }] };
      }
      if (property.m_Type === 'UnityEditor.ShaderGraph.Internal.ColorShaderProperty') {
        const value = object(property.m_Value);
        const color = ['r', 'g', 'b', 'a'].map((key) => Number(value[key]));
        if (color.some((number) => !Number.isFinite(number))) throw new Error('invalid Unity shader graph color');
        return {
          textures: [],
          factors: [{ key, kind: 'color', defaultValue: color as [number, number, number, number] }],
        };
      }
      throw new Error(`unsupported Unity shader graph property ${String(property.m_Type)}`);
    }
    if (type === 'UnityEditor.ShaderGraph.BlockNode' && id === base.m_ObjectId && inputs.length === 0) {
      const slots = Array.isArray(node.m_Slots) ? node.m_Slots.map((entry) => byId.get(nodeId(entry))) : [];
      const slot = slots[0];
      if (
        slots.length !== 1 ||
        slot?.m_Type !== 'UnityEditor.ShaderGraph.ColorRGBMaterialSlot' ||
        slot.m_Id !== 0 ||
        slot.m_SlotType !== 0 ||
        slot.m_ColorMode !== 0
      )
        throw new Error('unsupported Unity shader graph base color default');
      const value = object(slot.m_Value);
      const components = ['x', 'y', 'z'].map((key) => value[key]);
      if (components.some((component) => typeof component !== 'number' || !Number.isFinite(component) || component < 0))
        throw new Error('unsupported Unity shader graph base color default');
      return {
        textures: [],
        factors: [{ kind: 'constant', key: '', defaultValue: [...components, 1] as [number, number, number, number] }],
      };
    }
    const expected =
      type === 'UnityEditor.ShaderGraph.BlockNode' ? 1 : type === 'UnityEditor.ShaderGraph.MultiplyNode' ? 2 : -1;
    const expectedSlots = expected === 1 ? [0] : expected === 2 ? [0, 1] : [];
    if (
      inputs.length !== expected ||
      inputs.some((input) => !expectedSlots.includes(input.inputSlot)) ||
      new Set(inputs.map((input) => input.inputSlot)).size !== inputs.length
    )
      throw new Error(`unsupported Unity shader graph node ${String(type)}`);
    const terms = inputs.map(resolveSource);
    if (expected === 1) return terms[0]!;
    if (terms.some((term) => term.products || term.adjustment || term.scalarMask))
      return { textures: [], factors: [], products: terms };
    const result: ShaderGraphBase = { textures: [], factors: [] };
    for (const term of terms) {
      const channels = [
        ...(result.textureChannels ?? result.textures.map(() => 0)),
        ...(term.textureChannels ?? term.textures.map(() => 0)),
      ];
      const transforms = [
        ...(result.textureUvTransforms ?? result.textures.map(() => null)),
        ...(term.textureUvTransforms ?? term.textures.map(() => null)),
      ];
      const worldTransforms = [
        ...(result.textureWorldTransforms ?? result.textures.map(() => null)),
        ...(term.textureWorldTransforms ?? term.textures.map(() => null)),
      ];
      result.textures.push(...term.textures);
      if (channels.some((channel) => channel !== 0)) result.textureChannels = channels;
      if (transforms.some(Boolean)) result.textureUvTransforms = transforms;
      if (worldTransforms.some(Boolean)) result.textureWorldTransforms = worldTransforms;
      result.factors.push(...term.factors);
      if (term.blends) (result.blends ??= []).push(...term.blends);
    }
    return result;
  };
  return visit(base.m_ObjectId, new Set());
}
