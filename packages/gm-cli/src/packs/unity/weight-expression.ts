import type { ShaderGraphBase } from './shadergraph.js';

type Obj = Record<string, unknown>;
type Edge = { node: string; inputSlot: number; outputSlot: number };
export type WeightExpression<T> =
  | number
  | { term: T; channel: number; invert?: boolean }
  | {
      op: 'add' | 'subtract' | 'multiply' | 'divide' | 'clamp' | 'contrast' | 'invert';
      args: WeightExpression<T>[];
    };
export function mapWeightExpression<A, B>(value: WeightExpression<A>, map: (term: A) => B): WeightExpression<B> {
  if (typeof value === 'number') return value;
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
  visitTexture: (id: string, ancestors: Set<string>) => ShaderGraphBase,
  ancestors: Set<string>,
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
  const resolve = (edge: Edge, seen: Set<string>, narrow: boolean): WeightExpression<ShaderGraphBase> => {
    if (seen.has(edge.node)) throw new Error('cyclic Unity shader graph');
    const node = byId.get(edge.node);
    if (!node) throw new Error('missing Unity scalar node');
    const next = new Set(seen).add(edge.node);
    const linked = incoming.get(edge.node) ?? [];
    if (
      node.m_Type === 'UnityEditor.ShaderGraph.UnsupportedScalarConversion' &&
      edge.outputSlot === 0 &&
      linked.length === 1 &&
      linked[0]!.inputSlot === 0
    )
      return resolve(linked[0]!, next, true);
    if (node.m_Type === 'UnityEditor.ShaderGraph.SampleTexture2DNode') {
      const channel =
        edge.outputSlot >= 4 && edge.outputSlot <= 7 ? edge.outputSlot - 4 : narrow && edge.outputSlot === 0 ? 0 : -1;
      if (channel < 0) throw new Error(`unsupported Unity scalar texture output ${edge.outputSlot} at ${edge.node}`);
      return { term: visitTexture(edge.node, seen), channel };
    }
    if (node.m_Type === 'UnityEditor.ShaderGraph.PropertyNode' && edge.outputSlot === 0 && linked.length === 0) {
      const property = byId.get(ref(node.m_Property));
      const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
      if (
        property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty' ||
        typeof key !== 'string' ||
        !key
      )
        throw new Error('unsupported Unity scalar property');
      return numeric(floats.has(key) ? floats.get(key) : property.m_Value);
    }
    if (node.m_Type === 'UnityEditor.ShaderGraph.Vector1Node' && edge.outputSlot === 0) {
      if (linked.length > 1 || (linked.length === 1 && linked[0]!.inputSlot !== 1))
        throw new Error('invalid Unity scalar constant');
      return linked.length
        ? resolve(linked[0]!, next, false)
        : Array.isArray(node.m_Slots)
          ? slotDefault(node, 1)
          : numeric(node.m_Value);
    }
    const types: Record<
      string,
      {
        op: 'add' | 'subtract' | 'multiply' | 'divide' | 'clamp' | 'contrast' | 'invert';
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
    };
    const spec = typeof node.m_Type === 'string' ? types[node.m_Type] : undefined;
    if (
      !spec ||
      edge.outputSlot !== spec.output ||
      linked.some((entry) => !spec.inputs.includes(entry.inputSlot)) ||
      new Set(linked.map((entry) => entry.inputSlot)).size !== linked.length
    )
      throw new Error(`unsupported Unity scalar node ${String(node.m_Type)}`);
    return {
      op: spec.op,
      args: spec.inputs.map((slot) => {
        const input = linked.find((entry) => entry.inputSlot === slot);
        return input ? resolve(input, next, narrow) : slotDefault(node, slot);
      }),
    };
  };
  return resolve(start, ancestors, false);
}
