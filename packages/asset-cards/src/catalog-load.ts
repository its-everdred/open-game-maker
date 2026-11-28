import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadIndex } from './build.js';
import { buildCatalog, type CatalogIndex, type CatalogPackInput } from './catalog.js';
import { recoverCatalogCards } from './catalog-recover.js';

/** Load both authoritative inputs; card-index freshness is handled by loadIndex. */
export async function loadCatalog(root: string): Promise<CatalogIndex> {
  const [index, raw] = await Promise.all([loadIndex(root), readFile(join(root, 'catalog.json'), 'utf8')]);
  const parsed = JSON.parse(raw) as { packs?: CatalogPackInput[] };
  if (!Array.isArray(parsed.packs)) throw new Error('asset catalogue has no packs array');
  const result = buildCatalog(index, parsed.packs);
  await recoverCatalogCards(root, index, result);
  return result;
}
