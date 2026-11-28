import { selectUvBranch } from './uv-branch.js';
type Obj = Record<string, unknown>;
type Edge = { node: string; inputSlot: number; outputSlot: number };
type Component = [number, number, number, number];
type Value = { components: Component[]; world: boolean };
export type WorldUv = [number, number, number, number, number, number, number, number];

function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid Unity world UV object');
  return value as Obj;
}
function ref(value: unknown): string {
  const id = object(value).m_Id;
  if (typeof id !== 'string') throw new Error('invalid Unity world UV reference');
  return id;
}
function numeric(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '')
    throw new Error('invalid Unity world UV value');
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('invalid Unity world UV value');
  return n;
}
function constant(value: unknown): Component {
  return [0, 0, 0, numeric(value)];
}
function scalar(value: Component): number {
  if (value[0] !== 0 || value[1] !== 0 || value[2] !== 0) throw new Error('nonlinear Unity world UV graph');
  return value[3];
}

/** Compile affine absolute-world position projections for mesh baking. */
export function compileWorldUv(
  start: Edge,
  byId: Map<string, Obj>,
  incoming: Map<string, Edge[]>,
  floats: ReadonlyMap<string, unknown>,
  colors: ReadonlyMap<string, unknown>,
  ancestors: Set<string>,
): WorldUv {
  const resolve = (edge: Edge, seen: Set<string>): Value => {
    if (seen.has(edge.node)) throw new Error('cyclic Unity world UV graph');
    const node = byId.get(edge.node);
    if (!node) throw new Error('missing Unity world UV node');
    const next = new Set(seen).add(edge.node);
    const linked = incoming.get(edge.node) ?? [];
    if (new Set(linked.map((item) => item.inputSlot)).size !== linked.length)
      throw new Error('ambiguous Unity world UV input');
    const input = (id: number): Value => {
      const found = linked.find((item) => item.inputSlot === id);
      if (found) return resolve(found, next);
      const slots = Array.isArray(node.m_Slots)
        ? node.m_Slots.map((slot) => byId.get(ref(slot))).filter((slot) => slot?.m_Id === id && slot.m_SlotType === 0)
        : [];
      if (slots.length !== 1) throw new Error('missing Unity world UV input');
      const value = slots[0]!.m_Value;
      if (typeof value === 'number') return { components: [constant(value)], world: false };
      const fields = object(value);
      const components = ['x', 'y', 'z', 'w'].filter((key) => key in fields).map((key) => constant(fields[key]));
      if (!components.length) throw new Error('invalid Unity world UV input');
      return { components, world: false };
    };
    const type = node.m_Type;
    if (type === 'UnityEditor.ShaderGraph.BranchNode' && edge.outputSlot === 3)
      return input(selectUvBranch(linked, byId, incoming, floats));
    if (
      type === 'UnityEditor.ShaderGraph.Vector3Node' &&
      edge.outputSlot === 0 &&
      linked.every((item) => [1, 2, 3].includes(item.inputSlot))
    ) {
      const values = [input(1), input(2), input(3)];
      if (values.some((value) => value.components.length !== 1)) throw new Error('invalid Unity world UV vector width');
      return { components: values.map((value) => value.components[0]!), world: values.some((value) => value.world) };
    }
    if (
      type === 'UnityEditor.ShaderGraph.PositionNode' &&
      node.m_Space === 4 &&
      edge.outputSlot === 0 &&
      !linked.length
    )
      return {
        components: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
        ],
        world: true,
      };
    if (
      type === 'UnityEditor.ShaderGraph.UvVector2Conversion' &&
      edge.outputSlot === 0 &&
      linked.length === 1 &&
      linked[0]?.inputSlot === 0
    ) {
      const value = input(0);
      if (!value.components.length) throw new Error('invalid Unity world UV width');
      return { ...value, components: [value.components[0]!, value.components[value.components.length === 1 ? 0 : 1]!] };
    }
    if (
      type === 'UnityEditor.ShaderGraph.UnsupportedScalarConversion' &&
      edge.outputSlot === 0 &&
      linked.length === 1 &&
      linked[0]?.inputSlot === 0
    ) {
      const value = input(0);
      if (!value.components.length) throw new Error('invalid Unity world UV width');
      return { ...value, components: [value.components[0]!] };
    }
    if (type === 'UnityEditor.ShaderGraph.PropertyNode' && edge.outputSlot === 0 && !linked.length) {
      const property = byId.get(ref(node.m_Property));
      const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
      if (!property || typeof key !== 'string' || !key) throw new Error('invalid Unity world UV property');
      if (property.m_Type === 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty')
        return { components: [constant(floats.get(key) ?? property.m_Value)], world: false };
      const sizes: Record<string, number> = {
        'UnityEditor.ShaderGraph.Internal.Vector2ShaderProperty': 2,
        'UnityEditor.ShaderGraph.Internal.Vector3ShaderProperty': 3,
        'UnityEditor.ShaderGraph.Internal.Vector4ShaderProperty': 4,
        'UnityEditor.ShaderGraph.Internal.ColorShaderProperty': 4,
      };
      const size = sizes[String(property.m_Type)];
      if (!size) throw new Error('unsupported Unity world UV property');
      const value = object(colors.get(key) ?? property.m_Value);
      const keys = 'r' in value ? ['r', 'g', 'b', 'a'] : ['x', 'y', 'z', 'w'];
      return { components: keys.slice(0, size).map((part) => constant(value[part])), world: false };
    }
    if (
      type === 'UnityEditor.ShaderGraph.Vector1Node' &&
      edge.outputSlot === 0 &&
      linked.every((item) => item.inputSlot === 1)
    )
      return linked.length || Array.isArray(node.m_Slots)
        ? input(1)
        : { components: [constant(node.m_Value)], world: false };
    if (type === 'UnityEditor.ShaderGraph.ColorNode' && edge.outputSlot === 0 && !linked.length) {
      const state = object(node.m_Color);
      if (state.mode !== 0) throw new Error('unsupported Unity world UV color');
      const color = object(state.color);
      const components = ['r', 'g', 'b', 'a'].map((key, index) => {
        const value = numeric(color[key]);
        return constant(index === 3 ? value : value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      });
      return { components, world: false };
    }
    if (
      type === 'UnityEditor.ShaderGraph.AbsoluteNode' &&
      edge.outputSlot === 1 &&
      linked.every((item) => item.inputSlot === 0)
    ) {
      const value = input(0);
      return { components: value.components.map((part) => constant(Math.abs(scalar(part)))), world: false };
    }
    if (
      type === 'UnityEditor.ShaderGraph.SplitNode' &&
      edge.outputSlot >= 1 &&
      edge.outputSlot <= 4 &&
      linked.every((item) => item.inputSlot === 0)
    ) {
      const value = input(0),
        part = value.components[edge.outputSlot - 1];
      if (!part) throw new Error('unsupported Unity world UV split');
      return { components: [part], world: value.world };
    }
    if (
      type === 'UnityEditor.ShaderGraph.CombineNode' &&
      [4, 5, 6].includes(edge.outputSlot) &&
      linked.every((item) => item.inputSlot >= 0 && item.inputSlot <= 3)
    ) {
      const count = edge.outputSlot === 4 ? 4 : edge.outputSlot === 5 ? 3 : 2;
      const values = Array.from({ length: count }, (_, i) => input(i));
      if (values.some((value) => value.components.length !== 1)) throw new Error('unsupported Unity world UV combine');
      return { components: values.map((value) => value.components[0]!), world: values.some((value) => value.world) };
    }
    const ops: Record<string, 'add' | 'subtract' | 'multiply' | 'divide'> = {
      'UnityEditor.ShaderGraph.AddNode': 'add',
      'UnityEditor.ShaderGraph.SubtractNode': 'subtract',
      'UnityEditor.ShaderGraph.MultiplyNode': 'multiply',
      'UnityEditor.ShaderGraph.DivideNode': 'divide',
    };
    const op = ops[String(type)];
    if (op && edge.outputSlot === 2 && linked.every((item) => [0, 1].includes(item.inputSlot))) {
      const a = input(0),
        b = input(1),
        width = Math.max(a.components.length, b.components.length);
      if (width < 1 || width > 4 || !a.components.length || !b.components.length)
        throw new Error('unsupported Unity world UV width');
      const component = (value: Value, index: number): Component => {
        if (value.components.length === 1) return value.components[0]!;
        if (index < value.components.length) return value.components[index]!;
        return constant(index === 3 ? 1 : 0);
      };
      const components = Array.from({ length: width }, (_, i): Component => {
        const x = component(a, i),
          y = component(b, i);
        if (op === 'add' || op === 'subtract') {
          const sign = op === 'add' ? 1 : -1;
          return x.map((v, j) => v + sign * y[j]!) as Component;
        }
        if (op === 'divide') {
          const divisor = scalar(y);
          if (!divisor) throw new Error('division by zero in Unity world UV graph');
          return x.map((v) => v / divisor) as Component;
        }
        if (x[0] === 0 && x[1] === 0 && x[2] === 0) return y.map((v) => v * x[3]) as Component;
        const factor = scalar(y);
        return x.map((v) => v * factor) as Component;
      });
      return { components, world: a.world || b.world };
    }
    throw new Error(`unsupported Unity world UV node ${String(type)}`);
  };
  const result = resolve(start, ancestors);
  if (!result.world || result.components.length < 2) throw new Error('unsupported Unity world UV coordinates');
  const values = [...result.components[0]!, ...result.components[1]!] as WorldUv;
  if (values.some((value) => !Number.isFinite(value))) throw new Error('invalid Unity world UV transform');
  return values;
}
