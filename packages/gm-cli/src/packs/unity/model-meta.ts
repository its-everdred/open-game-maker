import { parseDocument } from 'yaml';

/** Resolve a Unity mesh subasset ID to its model-importer name. */
export function meshNameFromMeta(
  source: string,
  fileId: string,
  fallback?: { name: string; onInferred: () => void },
): string {
  const document = parseDocument(source, { intAsBigInt: true });
  if (document.errors.length) throw new Error(`invalid Unity model metadata: ${document.errors[0]!.message}`);
  const data = document.toJS({ mapAsMap: true, maxAliasCount: 0 }) as Map<unknown, unknown>;
  const importer = data.get('ModelImporter');
  if (!(importer instanceof Map)) throw new Error('missing Unity ModelImporter metadata');
  const names = importer.get('fileIDToRecycleName');
  if (names instanceof Map) {
    for (const [key, value] of names) {
      if (String(key) === fileId && typeof value === 'string' && value) return value;
    }
  }
  const table = importer.get('internalIDToNameTable');
  if (Array.isArray(table)) {
    for (const row of table) {
      if (!(row instanceof Map)) continue;
      const first = row.get('first');
      const second = row.get('second');
      if (
        first instanceof Map &&
        [...first.values()].some((value) => String(value) === fileId) &&
        typeof second === 'string' &&
        second
      )
        return second;
    }
  }
  const meshes = importer.get('meshes');
  const noMappings = (!(names instanceof Map) || names.size === 0) && (!Array.isArray(table) || table.length === 0);
  if (fallback?.name && noMappings && meshes instanceof Map && String(meshes.get('fileIdsGeneration')) === '2') {
    fallback.onInferred();
    return fallback.name;
  }
  throw new Error(`missing Unity mesh name for fileID ${fileId}`);
}
