import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import sharp from 'sharp';

/** Validate optional loading artwork against the publishable source-image contract. */
export async function checkLoading(game: string): Promise<string[]> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(resolve(game, 'gm.manifest.json'), 'utf8'));
  } catch {
    return ['gm.manifest.json: unable to read manifest'];
  }
  if (typeof manifest !== 'object' || manifest === null || !('loading' in manifest)) return [];
  const loading = manifest.loading;
  if (typeof loading !== 'object' || loading === null || Array.isArray(loading))
    return ['gm.manifest.json: loading must contain portrait and landscape paths'];
  const errors: string[] = [];
  for (const [orientation, minWidth, minHeight] of [
    ['portrait', 1440, 2560],
    ['landscape', 2560, 1440],
  ] as const) {
    const path = (loading as Record<string, unknown>)[orientation];
    if (typeof path !== 'string' || isAbsolute(path) || !/^media\/[a-zA-Z0-9_-]+\.png$/u.test(path)) {
      errors.push(`gm.manifest.json: loading.${orientation} must be a PNG path directly under media/`);
      continue;
    }
    const root = resolve(game, 'public');
    const file = resolve(root, path);
    if (!file.startsWith(root + sep)) {
      errors.push(`gm.manifest.json: loading.${orientation} must be inside public`);
      continue;
    }
    try {
      const realRoot = await realpath(root);
      const realFile = await realpath(file);
      if (!realFile.startsWith(realRoot + sep)) {
        errors.push(`${path}: loading image must be inside public`);
        continue;
      }
      const { width = 0, height = 0, format } = await sharp(realFile).metadata();
      if (format !== 'png' || width < minWidth || height < minHeight || width * minHeight !== height * minWidth)
        errors.push(
          `${path}: loading ${orientation} must be at least ${minWidth}x${minHeight} and ${minWidth / 160}:${minHeight / 160}`,
        );
    } catch {
      errors.push(`${path}: loading image is missing or unreadable`);
    }
  }
  return errors;
}
