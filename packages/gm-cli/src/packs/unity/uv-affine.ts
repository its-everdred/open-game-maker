import { selectUvBranch } from './uv-branch.js';
type Obj = Record<string, unknown>;
type Edge = { node: string; inputSlot: number; outputSlot: number };
type Component = [number, number, number];
type Vector = { channel?: number; components: Component[] };
export type UvAffine = { channel: number; matrix: [number, number, number, number, number, number] };

function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid Unity UV graph object');
  return value as Obj;
}
function ref(value: unknown): string {
  const id = object(value).m_Id;
  if (typeof id !== 'string') throw new Error('invalid Unity UV graph reference');
  return id;
}
function number(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '')
    throw new Error('invalid Unity UV graph value');
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('invalid Unity UV graph value');
  return result;
}
function constant(value: number): Component {
  return [0, 0, value];
}
function constantValue(value: Component): number {
  if (value[0] !== 0 || value[1] !== 0) throw new Error('nonlinear Unity UV graph');
  return value[2];
}
function combineChannels(a: Vector, b: Vector): number | undefined {
  if (a.channel !== undefined && b.channel !== undefined && a.channel !== b.channel)
    throw new Error('multiple Unity UV channels in one coordinate expression');
  return a.channel ?? b.channel;
}
function arithmetic(a: Vector, b: Vector, op: 'add' | 'subtract' | 'multiply' | 'divide'): Vector {
  const length = Math.max(a.components.length, b.components.length);
  if (![1, length].includes(a.components.length) || ![1, length].includes(b.components.length))
    throw new Error('unsupported Unity UV vector width');
  const channel = combineChannels(a, b);
  const components = Array.from({ length }, (_, index): Component => {
    const left = a.components[a.components.length === 1 ? 0 : index]!;
    const right = b.components[b.components.length === 1 ? 0 : index]!;
    if (op === 'add' || op === 'subtract') {
      const sign = op === 'add' ? 1 : -1;
      return [left[0] + sign * right[0], left[1] + sign * right[1], left[2] + sign * right[2]];
    }
    if (op === 'divide') {
      const denominator = constantValue(right);
      if (denominator === 0) throw new Error('division by zero in Unity UV graph');
      return [left[0] / denominator, left[1] / denominator, left[2] / denominator];
    }
    const scaleLeft = left[0] === 0 && left[1] === 0;
    const scaleRight = right[0] === 0 && right[1] === 0;
    if (!scaleLeft && !scaleRight) throw new Error('nonlinear Unity UV graph');
    const vector = scaleLeft ? right : left;
    const factor = scaleLeft ? left[2] : right[2];
    return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
  });
  return { channel, components };
}

/** Resolve UV-only affine arithmetic after material properties are known. */
export function compileUvAffine(
  start: Edge,
  byId: Map<string, Obj>,
  incoming: Map<string, Edge[]>,
  floats: ReadonlyMap<string, unknown>,
  colors: ReadonlyMap<string, unknown>,
  ancestors: Set<string>,
): UvAffine {
  const inputDefault = (node: Obj, slot: number): Vector => {
    if (!Array.isArray(node.m_Slots)) throw new Error('missing Unity UV input slot');
    const matches = node.m_Slots
      .map((item) => byId.get(ref(item)))
      .filter((item) => item?.m_Id === slot && item.m_SlotType === 0);
    if (matches.length !== 1) throw new Error('invalid Unity UV input slot');
    const input = matches[0]!;
    if (input.m_Type === 'UnityEditor.ShaderGraph.UVMaterialSlot') {
      const channel = input.m_Channel ?? 0;
      if (!Number.isInteger(channel) || (channel as number) < 0 || (channel as number) > 7)
        throw new Error('invalid Unity UV channel');
      return {
        channel: channel as number,
        components: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      };
    }
    if (typeof input.m_Value === 'number') return { components: [constant(number(input.m_Value))] };
    const value = object(input.m_Value);
    const components = ['x', 'y', 'z', 'w'].filter((key) => key in value).map((key) => constant(number(value[key])));
    if (!components.length) throw new Error('invalid Unity UV input value');
    return { components };
  };
  const resolve = (edge: Edge, seen: Set<string>): Vector => {
    if (seen.has(edge.node)) throw new Error('cyclic Unity UV graph');
    const node = byId.get(edge.node);
    if (!node) throw new Error('missing Unity UV graph node');
    const next = new Set(seen).add(edge.node);
    const linked = incoming.get(edge.node) ?? [];
    if (new Set(linked.map((item) => item.inputSlot)).size !== linked.length)
      throw new Error('ambiguous Unity UV graph input');
    const input = (slot: number): Vector => {
      const found = linked.find((item) => item.inputSlot === slot);
      return found ? resolve(found, next) : inputDefault(node, slot);
    };
    const type = node.m_Type;
    if (type === 'UnityEditor.ShaderGraph.BranchNode' && edge.outputSlot === 3)
      return input(selectUvBranch(linked, byId, incoming, floats));
    if (
      type === 'UnityEditor.ShaderGraph.UvVector2Conversion' &&
      edge.outputSlot === 0 &&
      linked.length === 1 &&
      linked[0]?.inputSlot === 0
    ) {
      const value = input(0);
      if (!value.components.length) throw new Error('unsupported Unity UV vector width');
      return {
        channel: value.channel,
        components: [value.components[0]!, value.components[value.components.length === 1 ? 0 : 1]!],
      };
    }
    if (type === 'UnityEditor.ShaderGraph.Vector2Node' && edge.outputSlot === 0 && !linked.length) {
      const value = object(node.m_Value);
      return { components: [constant(number(value.x)), constant(number(value.y))] };
    }
    if (
      (type === 'UnityEditor.ShaderGraph.SineNode' || type === 'UnityEditor.ShaderGraph.CosineNode') &&
      edge.outputSlot === 1 &&
      linked.every((item) => item.inputSlot === 0)
    ) {
      const value = input(0);
      let components = value.components;
      if (!linked.length && components.length > 1) {
        const first = constantValue(components[0]!);
        if (components.some((component) => constantValue(component) !== first))
          throw new Error('unsupported Unity UV trigonometric default');
        components = [components[0]!];
      }
      const fn = type === 'UnityEditor.ShaderGraph.SineNode' ? Math.sin : Math.cos;
      return { components: components.map((component) => constant(fn(constantValue(component)))) };
    }
    if (type === 'UnityEditor.ShaderGraph.UVNode' && edge.outputSlot === 0 && !linked.length) {
      const channel = node.m_OutputChannel ?? 0;
      if (!Number.isInteger(channel) || (channel as number) < 0 || (channel as number) > 7)
        throw new Error('invalid Unity UV channel');
      return {
        channel: channel as number,
        components: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      };
    }
    if (type === 'UnityEditor.ShaderGraph.PropertyNode' && edge.outputSlot === 0 && !linked.length) {
      const property = byId.get(ref(node.m_Property));
      const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
      if (!property || typeof key !== 'string' || !key) throw new Error('missing Unity UV property');
      if (property.m_Type === 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty')
        return { components: [constant(number(floats.get(key) ?? property.m_Value))] };
      const sizes: Record<string, number> = {
        'UnityEditor.ShaderGraph.Internal.ColorShaderProperty': 4,
        'UnityEditor.ShaderGraph.Internal.Vector2ShaderProperty': 2,
        'UnityEditor.ShaderGraph.Internal.Vector3ShaderProperty': 3,
        'UnityEditor.ShaderGraph.Internal.Vector4ShaderProperty': 4,
      };
      const size = typeof property.m_Type === 'string' ? sizes[property.m_Type] : undefined;
      if (!size) throw new Error('unsupported Unity UV property');
      const value = object(colors.get(key) ?? property.m_Value);
      const keys = 'r' in value ? ['r', 'g', 'b', 'a'] : ['x', 'y', 'z', 'w'];
      return { components: keys.slice(0, size).map((part) => constant(number(value[part]))) };
    }
    if (
      type === 'UnityEditor.ShaderGraph.Vector1Node' &&
      edge.outputSlot === 0 &&
      linked.every((item) => item.inputSlot === 1)
    )
      return linked.length
        ? input(1)
        : Array.isArray(node.m_Slots)
          ? inputDefault(node, 1)
          : { components: [constant(number(node.m_Value))] };
    if (
      type === 'UnityEditor.ShaderGraph.SplitNode' &&
      edge.outputSlot >= 1 &&
      edge.outputSlot <= 4 &&
      linked.every((item) => item.inputSlot === 0)
    ) {
      const value = input(0);
      const component = value.components[edge.outputSlot - 1];
      if (!component) throw new Error('unsupported Unity UV split channel');
      return { channel: value.channel, components: [component] };
    }
    if (type === 'UnityEditor.ShaderGraph.CombineNode' && [4, 5, 6].includes(edge.outputSlot)) {
      const count = edge.outputSlot === 4 ? 4 : edge.outputSlot === 5 ? 3 : 2;
      if (linked.some((item) => item.inputSlot < 0 || item.inputSlot > 3))
        throw new Error('unsupported Unity UV combine input');
      let channel: number | undefined;
      const components = Array.from({ length: count }, (_, index) => {
        const part = input(index);
        if (part.components.length !== 1) throw new Error('unsupported Unity UV combine width');
        channel = combineChannels({ channel, components: [] }, part);
        return part.components[0]!;
      });
      return { channel, components };
    }
    const ops: Record<string, 'add' | 'subtract' | 'multiply' | 'divide'> = {
      'UnityEditor.ShaderGraph.AddNode': 'add',
      'UnityEditor.ShaderGraph.SubtractNode': 'subtract',
      'UnityEditor.ShaderGraph.MultiplyNode': 'multiply',
      'UnityEditor.ShaderGraph.DivideNode': 'divide',
    };
    const op = typeof type === 'string' ? ops[type] : undefined;
    if (op && edge.outputSlot === 2 && linked.every((item) => [0, 1].includes(item.inputSlot)))
      return arithmetic(input(0), input(1), op);
    if (
      type === 'UnityEditor.ShaderGraph.DotProductNode' &&
      edge.outputSlot === 2 &&
      linked.every((item) => [0, 1].includes(item.inputSlot))
    ) {
      const left = input(0),
        right = input(1);
      if (left.components.length !== right.components.length || !left.components.length)
        throw new Error('unsupported Unity UV dot product width');
      const product = arithmetic(left, right, 'multiply');
      const result = product.components.reduce(
        (sum, component): Component => [sum[0] + component[0], sum[1] + component[1], sum[2] + component[2]],
        [0, 0, 0] as Component,
      );
      return { channel: product.channel, components: [result] };
    }
    if (
      type === 'UnityEditor.ShaderGraph.RotateNode' &&
      edge.outputSlot === 3 &&
      linked.every((item) => [0, 1, 2].includes(item.inputSlot))
    ) {
      const uv = input(0),
        center = input(1),
        rotation = input(2);
      if (
        uv.components.length !== 2 ||
        center.components.length !== 2 ||
        rotation.components.length !== 1 ||
        rotation.channel !== undefined
      )
        throw new Error('unsupported Unity UV rotation');
      const unit = node.m_Unit ?? 0;
      if (unit !== 0 && unit !== 1) throw new Error('unsupported Unity UV rotation unit');
      const angle = constantValue(rotation.components[0]!) * (unit === 1 ? Math.PI / 180 : 1);
      const c = Math.cos(angle),
        s = Math.sin(angle);
      const delta = arithmetic(uv, center, 'subtract');
      const [x, y] = delta.components as [Component, Component];
      const rotated: Vector = {
        channel: delta.channel,
        components: [
          [x[0] * c + y[0] * s, x[1] * c + y[1] * s, x[2] * c + y[2] * s],
          [-x[0] * s + y[0] * c, -x[1] * s + y[1] * c, -x[2] * s + y[2] * c],
        ],
      };
      return arithmetic(rotated, center, 'add');
    }
    throw new Error(`unsupported Unity UV node ${String(type)}`);
  };
  const result = resolve(start, ancestors);
  if (result.components.length < 2) throw new Error('unsupported Unity UV coordinate width');
  const [x, y] = result.components as [Component, Component];
  const matrix: UvAffine['matrix'] = [x[0], x[1], x[2], y[0], y[1], y[2]];
  if (matrix.some((value) => !Number.isFinite(value))) throw new Error('invalid Unity UV transform');
  return { channel: result.channel ?? 0, matrix };
}
