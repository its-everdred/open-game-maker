import { shaderGraphBase, shaderGraphDocuments, type ShaderGraphBase } from './shadergraph.js';
import { inlineUnitySubgraphs } from './subgraphs.js';

/** Resolve a directly connected texture alpha; reject other opacity graphs. */
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
  const output = input[0]?.m_OutputSlot;
  const sample = docs.find((doc) => doc.m_ObjectId === output?.m_Node?.m_Id);
  if (
    input.length !== 1 ||
    input[0]?.m_InputSlot?.m_SlotId !== 0 ||
    output?.m_SlotId !== 7 ||
    sample?.m_Type !== 'UnityEditor.ShaderGraph.SampleTexture2DNode'
  )
    throw new Error('unsupported Unity opacity graph');
  output.m_SlotId = 0;
  alpha.m_SerializedDescriptor = 'SurfaceDescription.BaseColor';
  const selected = docs.filter((doc) => doc === alpha || doc.m_SerializedDescriptor !== 'SurfaceDescription.BaseColor');
  const graphSource = selected.map((doc) => JSON.stringify(doc)).join('\n');
  const term = shaderGraphBase(inlineUnitySubgraphs(graphSource, load), floats, colors, textures);
  return { textures: [], factors: [], scalarMask: { term, channel: 3 } };
}
