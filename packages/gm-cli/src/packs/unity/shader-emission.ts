import { shaderGraphBase, shaderGraphDocuments, type ShaderGraphBase } from './shadergraph.js';
import { inlineUnitySubgraphs } from './subgraphs.js';

/** Resolve a shader graph's emission expression through the base-color evaluator. */
export function shaderGraphEmission(
  source: string,
  load: (guid: string) => string,
  floats: ReadonlyMap<string, unknown>,
  colors: ReadonlyMap<string, unknown>,
  textures: ReadonlyMap<string, unknown>,
): ShaderGraphBase {
  const docs = shaderGraphDocuments(source);
  const emission = docs.find((doc) => doc.m_SerializedDescriptor === 'SurfaceDescription.Emission');
  if (!emission || typeof emission.m_ObjectId !== 'string') throw new Error('missing Unity emission graph');
  const selected = docs.filter(
    (doc) => doc === emission || doc.m_SerializedDescriptor !== 'SurfaceDescription.BaseColor',
  );
  emission.m_SerializedDescriptor = 'SurfaceDescription.BaseColor';
  const graphSource = selected.map((doc) => JSON.stringify(doc)).join('\n');
  return shaderGraphBase(inlineUnitySubgraphs(graphSource, load), floats, colors, textures);
}
