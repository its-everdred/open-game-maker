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
function documents(source: string): GraphObject[] {
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
  kind: 'scalar' | 'color';
  defaultValue: number | [number, number, number, number];
};
export type ShaderGraphBase = { textures: string[]; factors: ShaderGraphFactor[] };

function graphOutputSlot(node: GraphObject | undefined): number {
  switch (node?.m_Type) {
    case 'UnityEditor.ShaderGraph.MultiplyNode':
      return 2;
    case 'UnityEditor.ShaderGraph.BranchNode':
    case 'UnityEditor.ShaderGraph.LerpNode':
      return 3;
    case 'UnityEditor.ShaderGraph.SampleTexture2DNode':
    case 'UnityEditor.ShaderGraph.PropertyNode':
      return 0;
    default:
      throw new Error(`unsupported Unity shader graph node ${String(node?.m_Type)}`);
  }
}

/** Resolve a base-color graph composed of texture samples, properties and multiplication. */
export function shaderGraphBase(source: string, floats: ReadonlyMap<string, unknown> = new Map()): ShaderGraphBase {
  const docs = documents(source);
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
  const visit = (id: string, ancestors: Set<string>): ShaderGraphBase => {
    if (ancestors.has(id)) throw new Error('cyclic Unity shader graph');
    const node = byId.get(id);
    if (!node) throw new Error(`missing Unity shader node ${id}`);
    const type = node.m_Type;
    const inputs = incoming.get(id) ?? [];
    if (type === 'UnityEditor.ShaderGraph.LerpNode') {
      if (
        inputs.length !== 3 ||
        new Set(inputs.map((input) => input.inputSlot)).size !== 3 ||
        inputs.some((input) => ![0, 1, 2].includes(input.inputSlot))
      )
        throw new Error('unsupported Unity shader graph interpolation');
      const amount = inputs.find((input) => input.inputSlot === 2)!;
      const amountNode = byId.get(amount.node);
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
      if (raw !== 0 && raw !== 1 && raw !== '0' && raw !== '1')
        throw new Error('unsupported Unity shader graph interpolation amount');
      const selected = inputs.find((input) => input.inputSlot === Number(raw))!;
      if (selected.outputSlot !== graphOutputSlot(byId.get(selected.node)))
        throw new Error('unsupported Unity shader graph output channel');
      return visit(selected.node, new Set(ancestors).add(id));
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
        inputs.some((input) => ![1, 2].includes(input.inputSlot) || input.outputSlot !== 0) ||
        new Set(inputs.map((input) => input.inputSlot)).size !== inputs.length
      )
        throw new Error('unsupported Unity texture sample input');
      const uv = inputs.find((input) => input.inputSlot === 2);
      if (uv) {
        const uvNode = byId.get(uv.node);
        if (
          uvNode?.m_Type !== 'UnityEditor.ShaderGraph.UVNode' ||
          (uvNode.m_OutputChannel !== undefined && uvNode.m_OutputChannel !== 0)
        )
          throw new Error('unsupported Unity texture UV graph');
      }
      const texture = inputs.find((input) => input.inputSlot === 1);
      if (!texture) return { textures: [`_SampleTexture2D_${id}_Texture_1`], factors: [] };
      const textureNode = byId.get(texture.node);
      if (textureNode?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode')
        throw new Error('unsupported Unity texture property');
      const property = byId.get(nodeId(textureNode.m_Property));
      const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
      if (
        property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.Texture2DShaderProperty' ||
        typeof key !== 'string' ||
        !key
      )
        throw new Error('unsupported Unity texture property');
      return { textures: [key], factors: [] };
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
    const expected =
      type === 'UnityEditor.ShaderGraph.BlockNode' ? 1 : type === 'UnityEditor.ShaderGraph.MultiplyNode' ? 2 : -1;
    const expectedSlots = expected === 1 ? [0] : expected === 2 ? [0, 1] : [];
    if (
      inputs.length !== expected ||
      inputs.some((input) => !expectedSlots.includes(input.inputSlot)) ||
      new Set(inputs.map((input) => input.inputSlot)).size !== inputs.length
    )
      throw new Error(`unsupported Unity shader graph node ${String(type)}`);
    const next = new Set(ancestors).add(id);
    const result: ShaderGraphBase = { textures: [], factors: [] };
    for (const input of inputs) {
      const source = byId.get(input.node);
      const outputSlot = graphOutputSlot(source);
      if (input.outputSlot !== outputSlot) throw new Error('unsupported Unity shader graph output channel');
      const term = visit(input.node, next);
      result.textures.push(...term.textures);
      result.factors.push(...term.factors);
    }
    return result;
  };
  return visit(base.m_ObjectId, new Set());
}
