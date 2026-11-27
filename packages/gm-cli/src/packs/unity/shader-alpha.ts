import { shaderGraphBase, shaderGraphDocuments, type ShaderGraphBase } from './shadergraph.js';
import { inlineUnitySubgraphs } from './subgraphs.js';

/** Read a constant, unconnected clip threshold. */
export function shaderGraphClipThreshold(source: string): number {
  const docs = shaderGraphDocuments(source);
  const graph = docs.find((doc) => doc.m_Type === 'UnityEditor.ShaderGraph.GraphData');
  const block = docs.find((doc) => doc.m_SerializedDescriptor === 'SurfaceDescription.AlphaClipThreshold');
  if (
    !graph ||
    !block ||
    typeof block.m_ObjectId !== 'string' ||
    !Array.isArray(graph.m_Edges) ||
    !Array.isArray(block.m_Slots) ||
    block.m_Slots.length !== 1
  )
    throw new Error('unsupported Unity alpha clip threshold');
  const connected = graph.m_Edges.some((edge) => {
    const input = (edge as { m_InputSlot?: { m_Node?: { m_Id?: string } } }).m_InputSlot;
    return input?.m_Node?.m_Id === block.m_ObjectId;
  });
  const ref = block.m_Slots[0] as { m_Id?: string };
  const slot = docs.find((doc) => doc.m_ObjectId === ref.m_Id);
  const value = slot?.m_Value;
  if (
    connected ||
    slot?.m_Type !== 'UnityEditor.ShaderGraph.Vector1MaterialSlot' ||
    slot.m_Id !== 0 ||
    slot.m_SlotType !== 0 ||
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new Error('unsupported Unity alpha clip threshold');
  return value;
}

/** Resolve a sampled scalar opacity, optionally multiplied by a nonnegative property. */
export function shaderGraphAlpha(
  source: string,
  load: (guid: string) => string,
  floats: ReadonlyMap<string, unknown>,
  colors: ReadonlyMap<string, unknown>,
  textures: ReadonlyMap<string, unknown>,
): ShaderGraphBase {
  const docs = shaderGraphDocuments(source);
  const graph = docs.find((doc) => doc.m_Type === 'UnityEditor.ShaderGraph.GraphData');
  const alpha = docs.find((doc) => doc.m_SerializedDescriptor === 'SurfaceDescription.Alpha');
  if (!graph || !alpha || typeof alpha.m_ObjectId !== 'string' || !Array.isArray(graph.m_Edges))
    throw new Error('unsupported Unity opacity graph');
  const edges = graph.m_Edges as Array<{
    m_InputSlot?: { m_Node?: { m_Id?: string }; m_SlotId?: number };
    m_OutputSlot?: { m_Node?: { m_Id?: string }; m_SlotId?: number };
  }>;
  const input = edges.filter((edge) => edge.m_InputSlot?.m_Node?.m_Id === alpha.m_ObjectId);
  let output = input[0]?.m_OutputSlot;
  const sourceNode = docs.find((doc) => doc.m_ObjectId === output?.m_Node?.m_Id);
  let multiplier = 1;
  if (sourceNode?.m_Type === 'UnityEditor.ShaderGraph.MultiplyNode' && output?.m_SlotId === 2) {
    const factors = edges.filter((edge) => edge.m_InputSlot?.m_Node?.m_Id === sourceNode.m_ObjectId);
    const sampleEdge = factors.find(
      (edge) =>
        [0, 7].includes(edge.m_OutputSlot?.m_SlotId ?? -1) &&
        docs.some(
          (doc) =>
            doc.m_ObjectId === edge.m_OutputSlot?.m_Node?.m_Id &&
            doc.m_Type === 'UnityEditor.ShaderGraph.SampleTexture2DNode',
        ),
    );
    const propertyEdge = factors.find((edge) => edge !== sampleEdge);
    const propertyNode = docs.find((doc) => doc.m_ObjectId === propertyEdge?.m_OutputSlot?.m_Node?.m_Id);
    const propertyRef = propertyNode?.m_Property as { m_Id?: string } | undefined;
    const property = docs.find((doc) => doc.m_ObjectId === propertyRef?.m_Id);
    const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
    multiplier = Number(typeof key === 'string' ? (floats.get(key) ?? property?.m_Value) : NaN);
    if (
      factors.length !== 2 ||
      new Set(factors.map((edge) => edge.m_InputSlot?.m_SlotId)).size !== 2 ||
      factors.some((edge) => ![0, 1].includes(edge.m_InputSlot?.m_SlotId ?? -1)) ||
      propertyEdge?.m_OutputSlot?.m_SlotId !== 0 ||
      propertyNode?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode' ||
      property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty' ||
      typeof key !== 'string' ||
      !Number.isFinite(multiplier) ||
      multiplier < 0 ||
      !sampleEdge?.m_OutputSlot
    )
      throw new Error('unsupported Unity opacity graph');
    output = { ...sampleEdge.m_OutputSlot, m_Node: { ...sampleEdge.m_OutputSlot.m_Node } };
    input[0]!.m_OutputSlot = output;
  }
  const sample = docs.find((doc) => doc.m_ObjectId === output?.m_Node?.m_Id);
  const channel =
    output?.m_SlotId === 7
      ? 3
      : output?.m_SlotId === 0 && sourceNode?.m_Type === 'UnityEditor.ShaderGraph.MultiplyNode'
        ? 0
        : -1;
  if (
    input.length !== 1 ||
    input[0]?.m_InputSlot?.m_SlotId !== 0 ||
    !output ||
    channel < 0 ||
    sample?.m_Type !== 'UnityEditor.ShaderGraph.SampleTexture2DNode'
  )
    throw new Error('unsupported Unity opacity graph');
  output.m_SlotId = 0;
  alpha.m_SerializedDescriptor = 'SurfaceDescription.BaseColor';
  const selected = docs.filter((doc) => doc === alpha || doc.m_SerializedDescriptor !== 'SurfaceDescription.BaseColor');
  const graphSource = selected.map((doc) => JSON.stringify(doc)).join('\n');
  const term = shaderGraphBase(inlineUnitySubgraphs(graphSource, load), floats, colors, textures);
  return {
    textures: [],
    factors: [{ kind: 'constant', key: '', defaultValue: multiplier }],
    scalarMask: { term, channel },
  };
}
