import { isAbsolute, relative, resolve, sep } from 'node:path';

import { loadEnv } from '@ogm/config';

/** Return a portable key only for a file in the intended library preview bucket. */
export function outputKey(out: string, assetsRoot?: string): string {
  const root = assetsRoot ?? loadEnv('asset-previews', { OGM_ASSETS_ROOT: { kind: 'path' } }).OGM_ASSETS_ROOT;
  const key = relative(resolve(root), resolve(out));
  if (isAbsolute(key) || key === '..' || key.startsWith(`..${sep}`)) {
    throw new Error('preview output must be inside the asset library');
  }
  const portable = key.split(sep).join('/');
  if (!portable.startsWith('previews/') && !portable.startsWith('private/previews/')) {
    throw new Error('preview output must be inside a previews bucket');
  }
  return portable;
}
