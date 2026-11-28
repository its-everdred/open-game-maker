import { shaderGraphDocuments } from './shadergraph.js';

type Obj = Record<string, unknown>;
type Endpoint = { m_Node: { m_Id: string }; m_SlotId: number };
type Edge = { m_InputSlot: Endpoint; m_OutputSlot: Endpoint };
function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid Unity subgraph data');
  return value as Obj;
}
function ref(value: unknown): string {
  const id = object(value).m_Id;
  if (typeof id !== 'string') throw new Error('invalid Unity subgraph reference');
  return id;
}
function edges(graph: Obj): Edge[] {
  if (!Array.isArray(graph.m_Edges)) throw new Error('invalid Unity subgraph edges');
  return graph.m_Edges.map((value) => {
    const edge = object(value);
    const input = object(edge.m_InputSlot);
    const output = object(edge.m_OutputSlot);
    if (typeof input.m_SlotId !== 'number' || typeof output.m_SlotId !== 'number')
      throw new Error('invalid Unity subgraph edge slot');
    return {
      m_InputSlot: { m_Node: { m_Id: ref(input.m_Node) }, m_SlotId: input.m_SlotId },
      m_OutputSlot: { m_Node: { m_Id: ref(output.m_Node) }, m_SlotId: output.m_SlotId },
    };
  });
}

/** Inline connected Unity subgraphs before resolving the base-color graph. */
export function inlineUnitySubgraphs(source: string, load: (guid: string) => string): string {
  let count = 0;
  function expand(text: string, stack: string[], requested?: Set<number>): Obj[] {
    const docs = shaderGraphDocuments(text);
    const idsSeen = new Set<string>();
    for (const doc of docs) {
      if (typeof doc.m_ObjectId !== 'string') continue;
      if (idsSeen.has(doc.m_ObjectId)) throw new Error('duplicate Unity shader graph object ID');
      idsSeen.add(doc.m_ObjectId);
    }
    const graph = docs.find((doc) => doc.m_Type === 'UnityEditor.ShaderGraph.GraphData');
    if (!graph) throw new Error('missing Unity graph data');
    const root = requested
      ? docs.find((doc) => doc.m_Type === 'UnityEditor.ShaderGraph.SubGraphOutputNode')
      : docs.find((doc) => doc.m_SerializedDescriptor === 'SurfaceDescription.BaseColor');
    if (!root || typeof root.m_ObjectId !== 'string') throw new Error('missing Unity graph output');
    for (;;) {
      const allEdges = edges(graph);
      const reachable = new Set<string>();
      const pending: string[] = [root.m_ObjectId as string];
      const selected: Edge[] = [];
      while (pending.length) {
        const id: string = pending.pop()!;
        if (reachable.has(id)) continue;
        reachable.add(id);
        for (const edge of allEdges) {
          if (
            edge.m_InputSlot.m_Node.m_Id !== id ||
            (id === root.m_ObjectId && requested && !requested.has(edge.m_InputSlot.m_SlotId))
          )
            continue;
          selected.push(edge);
          pending.push(edge.m_OutputSlot.m_Node.m_Id);
        }
      }
      graph.m_Edges = selected;
      const node = docs.find(
        (doc) =>
          doc.m_Type === 'UnityEditor.ShaderGraph.SubGraphNode' &&
          typeof doc.m_ObjectId === 'string' &&
          reachable.has(doc.m_ObjectId),
      );
      if (!node) break;
      if (++count > 64 || typeof node.m_ObjectId !== 'string') throw new Error('too many Unity subgraphs');
      const serialized = JSON.parse(String(node.m_SerializedSubGraph));
      const guid = object(object(serialized).subGraph).guid;
      if (typeof guid !== 'string' || !/^[a-f0-9]{32}$/i.test(guid)) throw new Error('invalid Unity subgraph GUID');
      if (stack.includes(guid)) throw new Error('cyclic Unity subgraph');
      const requestedOutputs = new Set(
        selected
          .filter((edge) => edge.m_OutputSlot.m_Node.m_Id === node.m_ObjectId)
          .map((edge) => edge.m_OutputSlot.m_SlotId),
      );
      const child = expand(load(guid), [...stack, guid], requestedOutputs);
      const childGraph = child.find((doc) => doc.m_Type === 'UnityEditor.ShaderGraph.GraphData');
      const childOutput = child.find((doc) => doc.m_Type === 'UnityEditor.ShaderGraph.SubGraphOutputNode');
      if (!childGraph || !childOutput || typeof childOutput.m_ObjectId !== 'string')
        throw new Error('missing Unity subgraph output');
      if (
        !Array.isArray(node.m_PropertyGuids) ||
        !Array.isArray(node.m_PropertyIds) ||
        node.m_PropertyGuids.length !== node.m_PropertyIds.length ||
        new Set(node.m_PropertyGuids).size !== node.m_PropertyGuids.length ||
        new Set(node.m_PropertyIds).size !== node.m_PropertyIds.length
      )
        throw new Error('invalid Unity subgraph properties');
      const parentEdges = edges(graph);
      const inputByGuid = new Map<string, Endpoint>();
      const slotByGuid = new Map<string, number>();
      for (let i = 0; i < node.m_PropertyGuids.length; i++) {
        const propertyGuid = node.m_PropertyGuids[i];
        const slot = node.m_PropertyIds[i];
        if (typeof propertyGuid !== 'string' || typeof slot !== 'number')
          throw new Error('invalid Unity subgraph property');
        slotByGuid.set(propertyGuid, slot);
        const matching = parentEdges.filter(
          (edge) => edge.m_InputSlot.m_Node.m_Id === node.m_ObjectId && edge.m_InputSlot.m_SlotId === slot,
        );
        if (matching.length > 1) throw new Error('ambiguous Unity subgraph input');
        if (matching.length === 1) inputByGuid.set(propertyGuid, matching[0]!.m_OutputSlot);
      }
      const childById = new Map(
        child.filter((doc) => typeof doc.m_ObjectId === 'string').map((doc) => [doc.m_ObjectId as string, doc]),
      );
      const childEdges = edges(childGraph);
      const prefix = `${node.m_ObjectId}/`;
      const propertyInputs = new Map<string, Endpoint>();
      const coercionEdges: Edge[] = [];
      const scalarSource = (endpoint: Endpoint): boolean => {
        const source = docs.find((doc) => doc.m_ObjectId === endpoint.m_Node.m_Id);
        if (source?.m_Type === 'UnityEditor.ShaderGraph.SampleTexture2DNode')
          return [4, 5, 6, 7].includes(endpoint.m_SlotId);
        if (
          source?.m_Type === 'UnityEditor.ShaderGraph.Vector1Node' ||
          source?.m_Type === 'UnityEditor.ShaderGraph.UnsupportedScalarConversion'
        )
          return endpoint.m_SlotId === 0;
        if (source?.m_Type === 'UnityEditor.ShaderGraph.PropertyNode' && endpoint.m_SlotId === 0) {
          const propertyId = ref(source.m_Property);
          return docs.some(
            (doc) =>
              doc.m_ObjectId === propertyId && doc.m_Type === 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty',
          );
        }
        return false;
      };
      for (const item of child) {
        if (item.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode' || typeof item.m_ObjectId !== 'string') continue;
        const property = childById.get(ref(item.m_Property));
        const propertyGuid = property ? object(property.m_Guid).m_GuidSerialized : undefined;
        if (typeof propertyGuid !== 'string') throw new Error('invalid Unity subgraph property GUID');
        let sourceEndpoint = inputByGuid.get(propertyGuid);
        if (!sourceEndpoint && childEdges.some((edge) => edge.m_OutputSlot.m_Node.m_Id === item.m_ObjectId)) {
          const slotId = slotByGuid.get(propertyGuid);
          if (slotId === undefined) throw new Error('missing Unity subgraph property binding');
          const slotRefs = Array.isArray(node.m_Slots) ? node.m_Slots.map(ref) : [];
          const slots = docs.filter((doc) => typeof doc.m_ObjectId === 'string' && slotRefs.includes(doc.m_ObjectId));
          const matches = slots.filter((slot) => slot.m_Id === slotId && slot.m_SlotType === 0);
          const slot = matches.length === 1 ? matches[0] : undefined;
          const constantId = `${prefix}default-${slotId}`;
          if (docs.some((doc) => doc.m_ObjectId === constantId)) throw new Error('duplicate Unity subgraph default');
          if (
            property?.m_Type === 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty' &&
            typeof slot?.m_Value === 'number' &&
            Number.isFinite(slot.m_Value)
          ) {
            docs.push({ m_ObjectId: constantId, m_Type: 'UnityEditor.ShaderGraph.Vector1Node', m_Value: slot.m_Value });
          } else if (
            property?.m_Type === 'UnityEditor.ShaderGraph.Internal.BooleanShaderProperty' &&
            slot?.m_Type === 'UnityEditor.ShaderGraph.BooleanMaterialSlot' &&
            typeof slot.m_Value === 'boolean'
          ) {
            const propertyId = `${constantId}-property`;
            if (docs.some((doc) => doc.m_ObjectId === propertyId)) throw new Error('duplicate Unity subgraph default');
            docs.push({
              m_ObjectId: propertyId,
              m_Type: 'UnityEditor.ShaderGraph.Internal.BooleanShaderProperty',
              m_DefaultReferenceName: propertyId,
              m_Value: slot.m_Value,
            });
            docs.push({
              m_ObjectId: constantId,
              m_Type: 'UnityEditor.ShaderGraph.PropertyNode',
              m_Property: { m_Id: propertyId },
            });
          } else if (
            property?.m_Type === 'UnityEditor.ShaderGraph.Internal.Vector2ShaderProperty' &&
            slot?.m_Type === 'UnityEditor.ShaderGraph.Vector2MaterialSlot'
          ) {
            const value = object(slot.m_Value);
            if (
              typeof value.x !== 'number' ||
              !Number.isFinite(value.x) ||
              typeof value.y !== 'number' ||
              !Number.isFinite(value.y)
            )
              throw new Error('unsupported unconnected Unity subgraph input');
            docs.push({
              m_ObjectId: constantId,
              m_Type: 'UnityEditor.ShaderGraph.Vector2Node',
              m_Value: { x: value.x, y: value.y },
            });
          } else
            throw new Error(
              `unsupported unconnected Unity subgraph input ${String(property?.m_Type)} ${String(slot?.m_Type)}`,
            );
          sourceEndpoint = { m_Node: { m_Id: constantId }, m_SlotId: 0 };
          inputByGuid.set(propertyGuid, sourceEndpoint);
        }
        if (sourceEndpoint && property?.m_Type === 'UnityEditor.ShaderGraph.Internal.Vector2ShaderProperty') {
          const castId = `${prefix}vector2-${slotByGuid.get(propertyGuid)}`;
          if (docs.some((doc) => doc.m_ObjectId === castId)) throw new Error('duplicate Unity subgraph conversion');
          docs.push({ m_ObjectId: castId, m_Type: 'UnityEditor.ShaderGraph.UvVector2Conversion' });
          coercionEdges.push({ m_InputSlot: { m_Node: { m_Id: castId }, m_SlotId: 0 }, m_OutputSlot: sourceEndpoint });
          sourceEndpoint = { m_Node: { m_Id: castId }, m_SlotId: 0 };
          inputByGuid.set(propertyGuid, sourceEndpoint);
        }
        if (
          sourceEndpoint &&
          property?.m_Type === 'UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty' &&
          !scalarSource(sourceEndpoint)
        ) {
          const castId = `${prefix}scalar-${slotByGuid.get(propertyGuid)}`;
          if (docs.some((doc) => doc.m_ObjectId === castId)) throw new Error('duplicate Unity subgraph conversion');
          docs.push({ m_ObjectId: castId, m_Type: 'UnityEditor.ShaderGraph.UnsupportedScalarConversion' });
          coercionEdges.push({ m_InputSlot: { m_Node: { m_Id: castId }, m_SlotId: 0 }, m_OutputSlot: sourceEndpoint });
          sourceEndpoint = { m_Node: { m_Id: castId }, m_SlotId: 0 };
          inputByGuid.set(propertyGuid, sourceEndpoint);
        }
        if (sourceEndpoint) propertyInputs.set(item.m_ObjectId, sourceEndpoint);
      }
      const sourceFor = (endpoint: Endpoint): Endpoint => {
        const propertyInput = propertyInputs.get(endpoint.m_Node.m_Id);
        if (propertyInput && endpoint.m_SlotId !== 0) throw new Error('unsupported Unity subgraph property output');
        return (
          propertyInput ?? {
            m_Node: { m_Id: `${prefix}${endpoint.m_Node.m_Id}` },
            m_SlotId: endpoint.m_SlotId,
          }
        );
      };
      const internal = childEdges
        .filter((edge) => edge.m_InputSlot.m_Node.m_Id !== childOutput.m_ObjectId)
        .map((edge) => ({
          m_InputSlot: {
            m_Node: { m_Id: `${prefix}${edge.m_InputSlot.m_Node.m_Id}` },
            m_SlotId: edge.m_InputSlot.m_SlotId,
          },
          m_OutputSlot: sourceFor(edge.m_OutputSlot),
        }));
      const outputs = new Map<number, Endpoint>();
      const outputSlotRefs = Array.isArray(childOutput.m_Slots) ? childOutput.m_Slots.map(ref) : [];
      for (const edge of childEdges.filter((entry) => entry.m_InputSlot.m_Node.m_Id === childOutput.m_ObjectId)) {
        if (outputs.has(edge.m_InputSlot.m_SlotId)) throw new Error('ambiguous Unity subgraph output');
        const slots = outputSlotRefs
          .map((id) => childById.get(id))
          .filter((slot) => slot?.m_Id === edge.m_InputSlot.m_SlotId && slot.m_SlotType === 0);
        if (slots.length !== 1) throw new Error('missing Unity subgraph output slot');
        if (
          ![
            'UnityEditor.ShaderGraph.Vector1MaterialSlot',
            'UnityEditor.ShaderGraph.Vector2MaterialSlot',
            'UnityEditor.ShaderGraph.Vector3MaterialSlot',
            'UnityEditor.ShaderGraph.Vector4MaterialSlot',
          ].includes(String(slots[0]!.m_Type))
        )
          throw new Error('unsupported Unity subgraph output type');
        let output = sourceFor(edge.m_OutputSlot);
        if (slots[0]!.m_Type === 'UnityEditor.ShaderGraph.Vector2MaterialSlot') {
          const castId = `${prefix}output-vector2-${edge.m_InputSlot.m_SlotId}`;
          if (docs.some((doc) => doc.m_ObjectId === castId)) throw new Error('duplicate Unity subgraph conversion');
          docs.push({ m_ObjectId: castId, m_Type: 'UnityEditor.ShaderGraph.UvVector2Conversion' });
          coercionEdges.push({ m_InputSlot: { m_Node: { m_Id: castId }, m_SlotId: 0 }, m_OutputSlot: output });
          output = { m_Node: { m_Id: castId }, m_SlotId: 0 };
        }
        if (slots[0]!.m_Type === 'UnityEditor.ShaderGraph.Vector1MaterialSlot') {
          const childSource = childById.get(edge.m_OutputSlot.m_Node.m_Id);
          const knownScalar =
            scalarSource(output) ||
            (childSource?.m_Type === 'UnityEditor.ShaderGraph.Vector1Node' && edge.m_OutputSlot.m_SlotId === 0) ||
            (childSource?.m_Type === 'UnityEditor.ShaderGraph.SampleTexture2DNode' &&
              [4, 5, 6, 7].includes(edge.m_OutputSlot.m_SlotId));
          if (!knownScalar) {
            const castId = `${prefix}output-scalar-${edge.m_InputSlot.m_SlotId}`;
            if (docs.some((doc) => doc.m_ObjectId === castId)) throw new Error('duplicate Unity subgraph conversion');
            docs.push({ m_ObjectId: castId, m_Type: 'UnityEditor.ShaderGraph.UnsupportedScalarConversion' });
            coercionEdges.push({ m_InputSlot: { m_Node: { m_Id: castId }, m_SlotId: 0 }, m_OutputSlot: output });
            output = { m_Node: { m_Id: castId }, m_SlotId: 0 };
          }
        }
        outputs.set(edge.m_InputSlot.m_SlotId, output);
      }
      const combined = parentEdges.flatMap((edge) => {
        if (edge.m_InputSlot.m_Node.m_Id === node.m_ObjectId) return [];
        if (edge.m_OutputSlot.m_Node.m_Id !== node.m_ObjectId) return [edge];
        const replacement = outputs.get(edge.m_OutputSlot.m_SlotId);
        if (!replacement) throw new Error('missing Unity subgraph output connection');
        return [{ ...edge, m_OutputSlot: replacement }];
      });
      graph.m_Edges = [...combined, ...internal, ...coercionEdges];
      docs.splice(docs.indexOf(node), 1);
      const ids = new Set(
        child.filter((doc) => typeof doc.m_ObjectId === 'string').map((doc) => doc.m_ObjectId as string),
      );
      const rename = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(rename);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(
          Object.entries(value as Obj).map(([key, item]) => [
            key,
            (key === 'm_ObjectId' || key === 'm_Id') && typeof item === 'string' && ids.has(item)
              ? `${prefix}${item}`
              : rename(item),
          ]),
        );
      };
      docs.push(
        ...child
          .filter(
            (doc) => doc !== childGraph && doc !== childOutput && doc.m_Type !== 'UnityEditor.ShaderGraph.PropertyNode',
          )
          .map((doc) => rename(doc) as Obj),
      );
    }
    return docs;
  }
  return expand(source, [])
    .map((doc) => JSON.stringify(doc))
    .join('\n');
}
