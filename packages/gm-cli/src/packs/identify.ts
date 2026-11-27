import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { extname, join, posix as pathPosix, relative, sep } from 'node:path';

import { detectVendor, type Vendor } from './vendor.js';

export type Kind = 'model' | 'anim' | 'sprite' | 'texture' | 'vfx' | 'audio' | 'ui' | 'inspiration';
export type Item = {
  path: string;
  kind: Kind;
  subkind?: string;
  companions: string[];
  role: 'primary';
  vendor?: { tilePx?: number; spacingPx?: number; marginPx?: number };
};
export type IdentifyResult = {
  vendor: Vendor;
  items: Item[];
  dropped: string[];
  hashManifest: string;
  sceneSources: string[];
  prefabSources: string[];
};

const EXECUTABLE = new Set([
  'exe',
  'msi',
  'dll',
  'so',
  'dylib',
  'sh',
  'bat',
  'cmd',
  'ps1',
  'appimage',
  'jar',
  'apk',
  'deb',
  'rpm',
  'dmg',
  'app',
  'com',
  'scr',
  'vbs',
]);
const ENGINE_ONLY = new Set(['meta', 'uasset', 'cs', 'asmdef']);
const MODEL = new Set(['glb', 'gltf', 'fbx', 'obj', 'blend', 'dae', '3ds', 'stl', 'ply', 'usd', 'usdz', 'vox']);
const IMAGE = new Set([
  'png',
  'jpg',
  'jpeg',
  'tga',
  'webp',
  'psd',
  'bmp',
  'gif',
  'tif',
  'tiff',
  'exr',
  'hdr',
  'ktx2',
  'dds',
  'svg',
]);
const AUDIO = new Set(['wav', 'ogg', 'mp3', 'flac', 'opus', 'm4a', 'aif', 'aiff']);
const FONT = new Set(['ttf', 'otf', 'woff', 'woff2', 'fnt']);
const MAP = new Set(['fcw', 'fct']);

function relativePosix(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

async function filesUnder(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const file = join(entry.parentPath, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`links are not allowed in extracted content: ${relativePosix(root, file)}`);
    if (entry.isFile()) files.push(file);
  }
  return files.sort();
}

function classify(path: string): Pick<Item, 'kind' | 'subkind'> | null {
  const extension = extname(path).slice(1).toLowerCase();
  if (MODEL.has(extension)) {
    if (/(^|\/)(characters?|heroes?)(\/|$)/i.test(path)) return { kind: 'model', subkind: 'character' };
    if (/(^|\/)(creatures?|monsters?)(\/|$)/i.test(path)) return { kind: 'model', subkind: 'creature' };
    if (/(^|\/)(vehicles?)(\/|$)/i.test(path)) return { kind: 'model', subkind: 'vehicle' };
    if (/(^|\/)(buildings?|architecture)(\/|$)/i.test(path)) return { kind: 'model', subkind: 'building' };
    if (/(^|\/)(nature|plants?|trees?)(\/|$)/i.test(path)) return { kind: 'model', subkind: 'nature' };
    return { kind: 'model', subkind: 'prop' };
  }
  if (AUDIO.has(extension)) {
    if (/(^|\/)(music)(\/|$)/i.test(path))
      return { kind: 'audio', subkind: /loop/i.test(path) ? 'music/loop' : 'music/track' };
    if (/(^|\/)(ambience|ambient)(\/|$)/i.test(path)) return { kind: 'audio', subkind: 'ambience' };
    if (/(^|\/)(voice|dialogue)(\/|$)/i.test(path)) return { kind: 'audio', subkind: 'voice' };
    return { kind: 'audio', subkind: 'sfx/other' };
  }
  if (FONT.has(extension)) return { kind: 'ui', subkind: 'font' };
  if (MAP.has(extension)) return { kind: 'inspiration', subkind: 'map' };
  if (IMAGE.has(extension)) {
    if (/(^|\/)textures?(\/|$)/i.test(path)) return { kind: 'texture', subkind: 'material' };
    if (/(^|\/)(ui|icons?)(\/|$)/i.test(path)) return { kind: 'ui', subkind: 'icon' };
    if (/(^|\/)(vfx|effects?)(\/|$)/i.test(path)) return { kind: 'vfx', subkind: 'flipbook' };
    if (/(^|\/)(tiles?|tilesets?)(\/|$)/i.test(path)) return { kind: 'sprite', subkind: 'tile' };
    return { kind: 'sprite', subkind: 'prop' };
  }
  if (extension === 'anim') return { kind: 'anim', subkind: 'humanoid' };
  return null;
}

type ImageIndex = { byStem: Map<string, string[]>; byDirectory: Map<string, string[]> };

function indexImages(images: string[]): ImageIndex {
  const index: ImageIndex = { byStem: new Map(), byDirectory: new Map() };
  for (const image of images) {
    const lower = image.toLowerCase();
    const stem = pathPosix.basename(lower, pathPosix.extname(lower));
    const directory = pathPosix.dirname(lower);
    index.byStem.set(stem, [...(index.byStem.get(stem) ?? []), image]);
    index.byDirectory.set(directory, [...(index.byDirectory.get(directory) ?? []), image]);
    const segments = directory.split('/');
    for (let position = 0; position < segments.length; position += 1) {
      if (!/^textures?$/.test(segments[position] ?? '')) continue;
      const textureRoot = segments.slice(0, position + 1).join('/');
      index.byDirectory.set(textureRoot, [...(index.byDirectory.get(textureRoot) ?? []), image]);
    }
  }
  return index;
}

function modelCompanions(model: string, images: ImageIndex): string[] {
  const modelDirectory = pathPosix.dirname(model);
  const modelStem = pathPosix.basename(model, pathPosix.extname(model)).toLowerCase();
  const textureDirectories = [
    pathPosix.join(modelDirectory, 'textures').toLowerCase(),
    pathPosix.join(pathPosix.dirname(modelDirectory), 'textures').toLowerCase(),
  ];
  return [
    ...(images.byStem.get(modelStem) ?? []),
    ...textureDirectories.flatMap((directory) => images.byDirectory.get(directory) ?? []),
  ];
}

type MaterialList = { path: string; text: string };

async function loadMaterialLists(root: string, paths: string[]): Promise<MaterialList[]> {
  const lists: MaterialList[] = [];
  for (const path of paths) {
    const file = join(root, ...path.split('/'));
    if ((await stat(file)).size > 8 * 1024 * 1024) continue;
    lists.push({ path, text: (await readFile(file, 'utf8')).toLowerCase() });
  }
  return lists;
}

function materialCompanions(model: string, metadata: MaterialList[]): string[] {
  const stem = pathPosix.basename(model, pathPosix.extname(model)).toLowerCase();
  return metadata.filter(({ text }) => text.includes(stem)).map(({ path }) => path);
}

function metadataNumber(text: string, label: string): number | undefined {
  const match = new RegExp(`${label}\\s*[:=]\\s*(\\d+)`, 'i').exec(text);
  return match?.[1] ? Number(match[1]) : undefined;
}

async function tilesheetFacts(root: string, files: string[]): Promise<Item['vendor']> {
  const path = files.find((file) => pathPosix.basename(file).toLowerCase() === 'tilesheet.txt');
  if (!path) return undefined;
  const file = join(root, ...path.split('/'));
  if ((await stat(file)).size > 1024 * 1024) return undefined;
  const text = await readFile(file, 'utf8');
  const size = /tile\s*size\s*[:=]\s*(\d+)(?:\s*x\s*(\d+))?/i.exec(text);
  const width = metadataNumber(text, '(?:tile\\s*)?width') ?? (size?.[1] ? Number(size[1]) : undefined);
  const height = metadataNumber(text, '(?:tile\\s*)?height') ?? (size?.[2] ? Number(size[2]) : width);
  const tilePx = width === height ? width : undefined;
  const spacingPx = metadataNumber(text, '(?:tile\\s*)?spacing');
  const marginPx = metadataNumber(text, '(?:tile\\s*)?margin');
  return {
    ...(tilePx ? { tilePx } : {}),
    ...(spacingPx !== undefined ? { spacingPx } : {}),
    ...(marginPx !== undefined ? { marginPx } : {}),
  };
}

async function digest(file: string): Promise<{ sha: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha: hash.digest('hex'), bytes };
}

async function hasExecutableMagic(file: string): Promise<boolean> {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (
      bytesRead >= 2 &&
      (header.subarray(0, 2).equals(Buffer.from('MZ')) || header.subarray(0, 2).equals(Buffer.from('#!')))
    ) {
      return true;
    }
    if (bytesRead === 4 && header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true;
    if (bytesRead === 4) {
      const magic = header.readUInt32BE(0);
      return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic);
    }
    return false;
  } finally {
    await handle.close();
  }
}

export async function identify(root: string): Promise<IdentifyResult> {
  const dropped: string[] = [];
  const initial = await filesUnder(root);
  const hasUnitySource = initial.some((file) => /\.(unity|prefab)$/i.test(file));
  for (const file of initial) {
    const extension = extname(file).slice(1).toLowerCase();
    const engineOnly = ENGINE_ONLY.has(extension) && !(extension === 'meta' && hasUnitySource);
    if (!EXECUTABLE.has(extension) && !engineOnly && !(await hasExecutableMagic(file))) continue;
    dropped.push(relativePosix(root, file));
    await rm(file, { force: true });
  }
  const files = await filesUnder(root);
  const vendor = await detectVendor(files);
  const images = files
    .filter((file) => IMAGE.has(extname(file).slice(1).toLowerCase()))
    .map((file) => relativePosix(root, file));
  const imageIndex = indexImages(images);
  const paths = files.map((file) => relativePosix(root, file));
  const materialLists = await loadMaterialLists(
    root,
    paths.filter((path) => /^MaterialList_.*\.txt$/i.test(pathPosix.basename(path))),
  );
  const tilesheet = await tilesheetFacts(root, paths);
  const items: Item[] = [];
  for (const file of files) {
    const path = relativePosix(root, file);
    const classification = classify(path);
    if (!classification) continue;
    const companions =
      classification.kind === 'model'
        ? [...modelCompanions(path, imageIndex), ...materialCompanions(path, materialLists)]
        : [];
    items.push({
      path,
      ...classification,
      companions: [...new Set(companions)].sort(),
      role: 'primary',
      ...(classification.kind === 'sprite' && tilesheet && /(^|\/)(tiles?|sprites?)(\/|$)/i.test(path)
        ? { vendor: tilesheet }
        : {}),
    });
  }
  const lines: string[] = [];
  for (const file of files) {
    const { sha, bytes } = await digest(file);
    lines.push(`${sha}  ${bytes}  ${relativePosix(root, file)}`);
  }
  if (paths.some((path) => /[\p{Cc}\p{Cf}]/u.test(path))) {
    throw new Error('extracted paths may not contain control or formatting characters');
  }
  return {
    vendor,
    items,
    dropped: dropped.sort(),
    hashManifest: `${lines.sort().join('\n')}\n`,
    sceneSources: paths.filter((path) => {
      if (/\.(unity|umap)$/i.test(path)) return true;
      const name = pathPosix.basename(path).toLowerCase();
      return (
        /\.glb$/i.test(path) &&
        (name === 'scene.glb' || name === 'demo.glb' || path.split('/').some((part) => part.toLowerCase() === 'scenes'))
      );
    }),
    prefabSources: paths.filter((path) => /\.prefab$/i.test(path)),
  };
}
