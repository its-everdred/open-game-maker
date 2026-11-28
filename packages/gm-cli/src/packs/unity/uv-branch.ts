type Obj = Record<string, unknown>;
type Edge = { node: string; inputSlot: number; outputSlot: number };

/** Select a material Boolean branch without evaluating the unused UV input. */
export function selectUvBranch(
  linked: Edge[],
  byId: Map<string, Obj>,
  incoming: Map<string, Edge[]>,
  floats: ReadonlyMap<string, unknown>,
): 1 | 2 {
  if (linked.some((edge) => ![0, 1, 2].includes(edge.inputSlot))) throw new Error('unsupported Unity UV branch');
  const selector = linked.find((edge) => edge.inputSlot === 0);
  const node = selector && byId.get(selector.node);
  const propertyRef = node?.m_Property;
  const propertyId =
    propertyRef && typeof propertyRef === 'object' && !Array.isArray(propertyRef)
      ? (propertyRef as Obj).m_Id
      : undefined;
  const property = typeof propertyId === 'string' ? byId.get(propertyId) : undefined;
  const key = property?.m_OverrideReferenceName || property?.m_DefaultReferenceName;
  if (
    !selector ||
    selector.outputSlot !== 0 ||
    node?.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode' ||
    (incoming.get(selector.node) ?? []).length ||
    property?.m_Type !== 'UnityEditor.ShaderGraph.Internal.BooleanShaderProperty' ||
    typeof property.m_Value !== 'boolean' ||
    typeof key !== 'string' ||
    !key
  )
    throw new Error('unsupported Unity UV branch selector');
  const raw = floats.has(key) ? floats.get(key) : Number(property.m_Value);
  if (raw !== 0 && raw !== 1 && raw !== '0' && raw !== '1') throw new Error('invalid Unity UV branch selector');
  return Number(raw) ? 1 : 2;
}
