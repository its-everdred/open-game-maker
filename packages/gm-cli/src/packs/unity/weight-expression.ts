import type { ShaderGraphBase } from './shadergraph.js';
import { selectUvBranch } from './uv-branch.js';

type Obj = Record<string, unknown>;
type Edge = { node: string; inputSlot: number; outputSlot: number };
export type WeightExpression<T> =
  | number
  | { normal: 0 | 1 | 2 }
  | { vertexColor: 0 | 1 | 2 | 3 }
  | { noise: { uv: number; scale: number } }
  | { term: T; channel: number | 'rgb'; invert?: boolean }
  | {
      op: 'add' | 'subtract' | 'multiply' | 'divide' | 'clamp' | 'contrast' | 'invert' | 'absolute' | 'overlay';
      args: WeightExpression<T>[];
    };
export function mapWeightExpression<A, B>(value: WeightExpression<A>, map: (term: A) => B): WeightExpression<B> {
  if (typeof value === 'number') return value;
  if ('normal' in value) return value;
  if ('vertexColor' in value) return value;
  if ('noise' in value) return value;
  if ('op' in value) return { ...value, args: value.args.map((arg) => mapWeightExpression(arg, map)) };
  return { ...value, term: map(value.term) };
}
function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid Unity scalar expression');
  return value as Obj;
}
function ref(value: unknown): string {
  const id = object(value).m_Id;
  if (typeof id !== 'string') throw new Error('invalid Unity scalar reference');
  return id;
}
function numeric(value: unknown): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '')
    throw new Error('unsupported Unity scalar value');
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('unsupported Unity scalar value');
  return result;
}

/** Compile only scalar-preserving graph arithmetic; unknown vector conversions fail closed. */
export function compileWeightExpression(
  start: Edge,
  byId: Map<string, Obj>,
  incoming: Map<string, Edge[]>,
  floats: ReadonlyMap<string, unknown>,
  visitTexture: (id: string, ancestors: Set<string>, channel: number | 'rgb') => ShaderGraphBase,
  ancestors: Set<string>,
  allowRgb = false,
): WeightExpression<ShaderGraphBase> {
  const slotDefault = (node: Obj, slotId: number): number => {
    if (!Array.isArray(node.m_Slots)) throw new Error('missing Unity scalar input slot');
    const slots = node.m_Slots
      .map((entry) => byId.get(ref(entry)))
      .filter((slot) => slot?.m_Id === slotId && slot.m_SlotType === 0);
    if (slots.length !== 1) throw new Error('invalid Unity scalar input slot');
    const value = slots[0]!.m_Value;
    if (typeof value === 'number') return numeric(value);
    const components = Object.values(object(value));
    if (!components.length || components.some((part) => typeof part !== 'number' || part !== components[0]))
      throw new Error('unsupported Unity vector scalar default');
    return numeric(components[0]);
  };
  const resolve = (
    edge: Edge,
    seen: Set<string>,
    narrow: boolean,
    vectorAllowed: boolean,
  ): WeightExpression<ShaderGraphBase> => {
    if (seen.has(edge.node)) throw new Error('cyclic Unity shader graph');
    const node = byId.get(edge.node);
    if (!node) throw new Error('missing Unity scalar node');
    const next = new Set(seen).add(edge.node);
    const linked = incoming.get(edge.node) ?? [];
    if (node.m_Type === 'UnityEditor.ShaderGraph.BranchNode' && edge.outputSlot === 3) {
      if (new Set(linked.map((entry) => entry.inputSlot)).size !== linked.length)
        throw new Error('ambiguous Unity scalar branch');
      const chosen = selectUvBranch(linked, byId, incoming, floats);
      const input = linked.find((entry) => entry.inputSlot === chosen);
      return input ? resolve(input, next, narrow, vectorAllowed) : slotDefault(node, chosen);
    }
    if (
      node.m_Type === 'UnityEditor.ShaderGraph.UnsupportedScalarConversion' &&
      edge.outputSlot === 0 &&
      linked.length === 1 &&
      linked[0]!.inputSlot === 0
    )
      return resolve(linked[0]!, next, true, false);
    if (node.m_Type === 'UnityEditor.ShaderGraph.SampleTexture2DNode') {
      const channel =
        edge.outputSlot >= 4 && edge.outputSlot <= 7
          ? edge.outputSlot - 4
          : narrow && edge.outputSlot === 0
            ? 0
            : vectorAllowed && edge.outputSlot === 0
              ? 'rgb'
              : -1;
      if (channel === -1) throw new Error(`unsupported Unity scalar texture output ${edge.outputSlot} at ${edge.node}`);
      return { term: visitTexture(edge.node, seen, channel), channel };
    }
    if (node.m_Type === 'UnityEditor.ShaderGraph.PropertyNode' && edge.outputSlot === 0 && linked.length === 0) {
      const property = byId.get(ref(node.m_Property));
      const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
      if (vectorAllowed && property?.m_Type === 'UnityEditor.ShaderGraph.Internal.ColorShaderProperty')
        return { term: visitTexture(edge.node, seen, 'rgb'), channel: 'rgb' };
      if (
        property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty' ||
        typeof key !== 'string' ||
        !key
      )
        throw new Error(`unsupported Unity scalar property ${String(property?.m_Type)}`);
      return numeric(floats.has(key) ? floats.get(key) : property.m_Value);
    }
    if (node.m_Type === 'UnityEditor.ShaderGraph.Vector1Node' && edge.outputSlot === 0) {
      if (linked.length > 1 || (linked.length === 1 && linked[0]!.inputSlot !== 1))
        throw new Error('invalid Unity scalar constant');
      return linked.length
        ? resolve(linked[0]!, next, false, false)
        : Array.isArray(node.m_Slots)
          ? slotDefault(node, 1)
          : numeric(node.m_Value);
    }
    if (node.m_Type === 'UnityEditor.ShaderGraph.RemapNode' && edge.outputSlot === 3) {
      if (linked.some((entry) => entry.inputSlot !== 0) || linked.length > 1 || !Array.isArray(node.m_Slots))
        throw new Error('unsupported Unity remap range');
      const range = (id: number): [number, number] => {
        const slots = (node.m_Slots as unknown[])
          .map((entry) => byId.get(ref(entry)))
          .filter((slot) => slot?.m_Id === id && slot.m_SlotType === 0);
        if (slots.length !== 1) throw new Error('invalid Unity remap range');
        const value = object(slots[0]!.m_Value);
        return [numeric(value.x), numeric(value.y)];
      };
      const [inMin, inMax] = range(1),
        [outMin, outMax] = range(2);
      if (inMin === inMax) throw new Error('unsupported Unity remap range');
      const input = linked.length ? resolve(linked[0]!, next, narrow, vectorAllowed) : slotDefault(node, 0);
      return {
        op: 'add',
        args: [
          { op: 'multiply', args: [{ op: 'subtract', args: [input, inMin] }, (outMax - outMin) / (inMax - inMin)] },
          outMin,
        ],
      };
    }
    if (node.m_Type === 'UnityEditor.ShaderGraph.NoiseNode' && node.m_SGVersion === 0 && edge.outputSlot === 2) {
      if (linked.some((entry) => entry.inputSlot !== 1) || linked.length > 1 || !Array.isArray(node.m_Slots))
        throw new Error('unsupported Unity noise inputs');
      const uvSlots = node.m_Slots
        .map((entry) => byId.get(ref(entry)))
        .filter((slot) => slot?.m_Id === 0 && slot.m_SlotType === 0);
      const uv = uvSlots[0]?.m_Channel;
      const scale = linked.length ? resolve(linked[0]!, next, false, false) : slotDefault(node, 1);
      if (
        uvSlots.length !== 1 ||
        !Number.isInteger(uv) ||
        Number(uv) < 0 ||
        Number(uv) > 7 ||
        typeof scale !== 'number' ||
        !Number.isFinite(scale)
      )
        throw new Error('unsupported Unity noise inputs');
      return { noise: { uv: Number(uv), scale } };
    }
    if (
      node.m_Type === 'UnityEditor.ShaderGraph.SplitNode' &&
      edge.outputSlot >= 1 &&
      edge.outputSlot <= 4 &&
      linked.length === 1 &&
      linked[0]!.inputSlot === 0
    ) {
      const source = byId.get(linked[0]!.node);
      if (
        source?.m_Type === 'UnityEditor.ShaderGraph.VertexColorNode' &&
        linked[0]!.outputSlot === 0 &&
        (incoming.get(linked[0]!.node) ?? []).length === 0
      )
        return { vertexColor: (edge.outputSlot - 1) as 0 | 1 | 2 | 3 };
      if (
        source?.m_Type === 'UnityEditor.ShaderGraph.NormalVectorNode' &&
        source.m_Space === 2 &&
        linked[0]!.outputSlot === 0 &&
        (incoming.get(linked[0]!.node) ?? []).length === 0 &&
        edge.outputSlot <= 3
      )
        return { normal: (edge.outputSlot - 1) as 0 | 1 | 2 };
      if (edge.outputSlot === 1) return resolve(linked[0]!, next, true, false);
      throw new Error(`unsupported Unity scalar split ${edge.node} channel ${edge.outputSlot}`);
    }
    const types: Record<
      string,
      {
        op:
          'add' | 'subtract' | 'multiply' | 'divide' | 'clamp' | 'contrast' | 'invert' | 'absolute' | 'lerp' | 'blend';
        output: number;
        inputs: number[];
      }
    > = {
      'UnityEditor.ShaderGraph.AddNode': { op: 'add', output: 2, inputs: [0, 1] },
      'UnityEditor.ShaderGraph.SubtractNode': { op: 'subtract', output: 2, inputs: [0, 1] },
      'UnityEditor.ShaderGraph.MultiplyNode': { op: 'multiply', output: 2, inputs: [0, 1] },
      'UnityEditor.ShaderGraph.DivideNode': { op: 'divide', output: 2, inputs: [0, 1] },
      'UnityEditor.ShaderGraph.ClampNode': { op: 'clamp', output: 3, inputs: [0, 1, 2] },
      'UnityEditor.ShaderGraph.ContrastNode': { op: 'contrast', output: 2, inputs: [0, 1] },
      'UnityEditor.ShaderGraph.OneMinusNode': { op: 'invert', output: 1, inputs: [0] },
      'UnityEditor.ShaderGraph.AbsoluteNode': { op: 'absolute', output: 1, inputs: [0] },
      'UnityEditor.ShaderGraph.LerpNode': { op: 'lerp', output: 3, inputs: [0, 1, 2] },
      'UnityEditor.ShaderGraph.BlendNode': { op: 'blend', output: 2, inputs: [0, 1, 3] },
    };
    const spec = typeof node.m_Type === 'string' ? types[node.m_Type] : undefined;
    if (
      !spec ||
      edge.outputSlot !== spec.output ||
      linked.some((entry) => !spec.inputs.includes(entry.inputSlot)) ||
      new Set(linked.map((entry) => entry.inputSlot)).size !== linked.length
    )
      throw new Error(`unsupported Unity scalar node ${String(node.m_Type)}`);
    const args = spec.inputs.map((slot) => {
      const input = linked.find((entry) => entry.inputSlot === slot);
      const descriptor = Array.isArray(node.m_Slots)
        ? node.m_Slots
            .map((entry) => byId.get(ref(entry)))
            .find((entry) => entry?.m_Id === slot && entry.m_SlotType === 0)
        : undefined;
      const allowsRgb =
        vectorAllowed &&
        descriptor?.m_Type !== 'UnityEditor.ShaderGraph.Vector1MaterialSlot' &&
        descriptor?.m_Type !== 'UnityEditor.ShaderGraph.Vector2MaterialSlot';
      return input ? resolve(input, next, narrow, allowsRgb) : slotDefault(node, slot);
    });
    if (spec.op === 'blend') {
      if (node.m_BlendMode !== 15 && node.m_BlendMode !== 19) throw new Error('unsupported Unity blend mode');
      const [base, blend, amount] = args;
      const result: WeightExpression<ShaderGraphBase> = {
        op: node.m_BlendMode === 15 ? 'overlay' : 'subtract',
        args: [base!, blend!],
      };
      return {
        op: 'add',
        args: [base!, { op: 'multiply', args: [{ op: 'subtract', args: [result, base!] }, amount!] }],
      };
    }
    if (spec.op === 'lerp') {
      const [a, b, amount] = args;
      return { op: 'add', args: [a!, { op: 'multiply', args: [{ op: 'subtract', args: [b!, a!] }, amount!] }] };
    }
    return { op: spec.op, args };
  };
  return resolve(start, ancestors, false, allowRgb);
}
