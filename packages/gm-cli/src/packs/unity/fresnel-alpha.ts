import { shaderGraphDocuments, type ShaderGraphBase } from './shadergraph.js';

/** Approximate a simple Fresnel opacity with its front-facing value. */
export function fresnelFrontAlpha(source: string, floats: ReadonlyMap<string, unknown>): ShaderGraphBase | undefined {
  const docs = shaderGraphDocuments(source);
  const graph = docs.find((doc) => doc.m_Type === 'UnityEditor.ShaderGraph.GraphData');
  const alpha = docs.find((doc) => doc.m_SerializedDescriptor === 'SurfaceDescription.Alpha');
  if (!graph || !alpha || !Array.isArray(graph.m_Edges)) return undefined;
  type Edge = {
    m_InputSlot?: { m_Node?: { m_Id?: string }; m_SlotId?: number };
    m_OutputSlot?: { m_Node?: { m_Id?: string }; m_SlotId?: number };
  };
  const edges = graph.m_Edges as Edge[];
  const node = (id: string | undefined) => docs.find((doc) => doc.m_ObjectId === id);
  const input = (id: unknown, slot: number) =>
    edges.filter((edge) => edge.m_InputSlot?.m_Node?.m_Id === id && edge.m_InputSlot?.m_SlotId === slot);
  const alphaEdges = input(alpha.m_ObjectId, 0);
  const lerp = node(alphaEdges[0]?.m_OutputSlot?.m_Node?.m_Id);
  if (
    alphaEdges.length !== 1 ||
    alphaEdges[0]?.m_OutputSlot?.m_SlotId !== 3 ||
    lerp?.m_Type !== 'UnityEditor.ShaderGraph.LerpNode'
  )
    return undefined;
  const lerpEdges = edges.filter((edge) => edge.m_InputSlot?.m_Node?.m_Id === lerp.m_ObjectId);
  if (lerpEdges.length !== 3 || [0, 1, 2].some((slot) => input(lerp.m_ObjectId, slot).length !== 1)) return undefined;
  const factor = input(lerp.m_ObjectId, 2)[0]?.m_OutputSlot;
  const fresnel = node(factor?.m_Node?.m_Id);
  if (factor?.m_SlotId !== 3 || fresnel?.m_Type !== 'UnityEditor.ShaderGraph.FresnelNode') return undefined;
  const fresnelEdges = edges.filter((edge) => edge.m_InputSlot?.m_Node?.m_Id === fresnel.m_ObjectId);
  if (
    fresnelEdges.length !== 1 ||
    fresnelEdges[0]?.m_InputSlot?.m_SlotId !== 2 ||
    fresnelEdges[0]?.m_OutputSlot?.m_SlotId !== 0
  )
    return undefined;
  const powerNode = node(fresnelEdges[0]?.m_OutputSlot?.m_Node?.m_Id);
  const powerSlots = Array.isArray(powerNode?.m_Slots)
    ? powerNode.m_Slots.map((ref) => node((ref as { m_Id?: string }).m_Id))
    : [];
  const power = powerSlots.find((slot) => slot?.m_Id === 1 && slot.m_SlotType === 0)?.m_Value;
  if (
    powerNode?.m_Type !== 'UnityEditor.ShaderGraph.Vector1Node' ||
    edges.some((edge) => edge.m_InputSlot?.m_Node?.m_Id === powerNode.m_ObjectId) ||
    typeof power !== 'number' ||
    !Number.isFinite(power) ||
    power <= 0
  )
    return undefined;
  const values = [0, 1].map((slot) => {
    const endpoint = input(lerp.m_ObjectId, slot)[0]?.m_OutputSlot;
    const propNode = node(endpoint?.m_Node?.m_Id);
    const property = node((propNode?.m_Property as { m_Id?: string } | undefined)?.m_Id);
    const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
    if (
      endpoint?.m_SlotId !== 0 ||
      propNode?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode' ||
      property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty' ||
      typeof key !== 'string' ||
      !key ||
      edges.some((edge) => edge.m_InputSlot?.m_Node?.m_Id === propNode.m_ObjectId)
    )
      return NaN;
    return Number(floats.get(key) ?? property.m_Value);
  });
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return undefined;
  return { textures: [], factors: [{ kind: 'constant', key: '', defaultValue: values[0]! }] };
}
