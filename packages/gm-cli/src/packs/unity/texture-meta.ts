import { parseDocument } from 'yaml';

/** Honor the Unity importer's color space and reject unsupported sampling modes. */
export function textureIsSrgb(source: string): boolean {
  const document = parseDocument(source);
  if (document.errors.length) throw new Error('invalid Unity texture metadata');
  const data = document.toJS({ maxAliasCount: 0 }) as {
    TextureImporter?: {
      mipmaps?: { sRGBTexture?: unknown };
      textureSettings?: { wrapU?: unknown; wrapV?: unknown; filterMode?: unknown };
    };
  };
  const importer = data?.TextureImporter;
  const value = importer?.mipmaps?.sRGBTexture;
  if (value !== 0 && value !== 1) throw new Error('missing Unity texture color space');
  const settings = importer?.textureSettings;
  if (settings?.wrapU !== 0 || settings.wrapV !== 0 || settings.filterMode !== 1) {
    throw new Error('unsupported Unity texture sampling mode');
  }
  return value === 1;
}
