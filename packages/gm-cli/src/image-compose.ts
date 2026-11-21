import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { IMAGE_SLOTS, ImageSlots, type SlotId, type ViewportId } from '@ogm/contracts';
import sharp, { type OverlayOptions } from 'sharp';

type Anchor = { x: number; y: number; width: number };
type Layer = { src: string; anchors: Partial<Record<ViewportId, Anchor>> };

function publicPath(publicRoot: string, path: string): string {
  if (isAbsolute(path)) throw new Error(`${path}: image path must be relative to public`);
  const file = resolve(publicRoot, path);
  if (!file.startsWith(publicRoot + sep)) throw new Error(`${path}: image path must be inside public`);
  return file;
}

async function readPublicImage(publicRoot: string, path: string): Promise<Buffer> {
  const file = publicPath(publicRoot, path);
  const [root, realFile] = await Promise.all([realpath(publicRoot), realpath(file)]);
  if (!realFile.startsWith(root + sep)) throw new Error(`${path}: image path must be inside public`);
  return readFile(realFile);
}

async function outputPath(publicRoot: string, path: string): Promise<string> {
  const destination = publicPath(publicRoot, path);
  const directory = relative(publicRoot, dirname(destination));
  let current = publicRoot;
  for (const segment of directory.split(sep).filter((part) => part && part !== '.')) {
    const next = resolve(current, segment);
    try {
      await mkdir(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    current = await realpath(next);
    if (!current.startsWith(publicRoot + sep)) throw new Error(`${path}: output path must be inside public`);
  }
  const finalDestination = resolve(current, basename(destination));
  try {
    const metadata = await lstat(finalDestination);
    if (metadata.isSymbolicLink()) throw new Error(`${path}: output path cannot be a symbolic link`);
    if (metadata.isFile() && metadata.nlink > 1) throw new Error(`${path}: output path cannot be a hard link`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return finalDestination;
}

/** Compose every declared layered image slot into its viewport variants. */
export async function composeSlots(game: string): Promise<string[]> {
  const manifestPath = resolve(game, 'gm.manifest.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error('gm.manifest.json: unable to read manifest');
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest))
    throw new Error('gm.manifest.json: invalid manifest');
  const images = (manifest as Record<string, unknown>).images;
  if (images === undefined) return [];
  const parsed = ImageSlots.safeParse(images);
  if (!parsed.success) throw new Error('gm.manifest.json: images does not match the image slot contract');

  for (const [slotName, entry] of Object.entries(parsed.data) as [SlotId, (typeof parsed.data)[SlotId]][]) {
    if (!entry || entry.mode !== 'layered' || !entry.variants) continue;
    const viewports = [
      ...new Set([...IMAGE_SLOTS[slotName].viewports, ...(Object.keys(entry.variants) as ViewportId[])]),
    ];
    const missing = viewports.find((viewport) => !entry.variants?.[viewport]);
    if (missing) throw new Error(`images.${slotName}: missing variant for ${missing}`);
  }

  const gameRoot = await realpath(game);
  const expectedPublicRoot = resolve(gameRoot, 'public');
  const publicRoot = await realpath(expectedPublicRoot);
  if (publicRoot !== expectedPublicRoot) throw new Error('public: must be a directory inside the game');

  const protectedSources = new Set<string>();
  for (const entry of Object.values(parsed.data)) {
    if (!entry) continue;
    const paths =
      entry.mode === 'layered'
        ? [entry.plate, ...entry.layers.map((layer) => layer.src)].filter((path): path is string => path !== undefined)
        : Object.values(entry.variants);
    for (const path of paths) {
      try {
        const canonical = await realpath(publicPath(publicRoot, path));
        if (!canonical.startsWith(publicRoot + sep)) throw new Error(`${path}: image path must be inside public`);
        protectedSources.add(canonical);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  const written: string[] = [];
  for (const [slotName, entry] of Object.entries(parsed.data) as [SlotId, (typeof parsed.data)[SlotId]][]) {
    if (!entry || entry.mode !== 'layered') continue;
    const slot = IMAGE_SLOTS[slotName];
    const viewports = [...new Set([...slot.viewports, ...(Object.keys(entry.variants ?? {}) as ViewportId[])])];
    for (const viewport of viewports) {
      const display = slot.display[viewport];
      const width = Math.round(display.width * 2);
      const height = Math.round(display.height * 2);
      const composites: OverlayOptions[] = [];
      if (entry.plate) {
        const plate = await readPublicImage(publicRoot, entry.plate);
        composites.push({
          input: await sharp(plate).resize(width, height, { fit: 'cover', position: 'centre' }).png().toBuffer(),
        });
      }
      for (const layer of entry.layers as Layer[]) {
        const anchor = layer.anchors[viewport];
        if (!anchor) continue;
        const source = await readPublicImage(publicRoot, layer.src);
        const sourceMeta = await sharp(source).metadata();
        if (!sourceMeta.width || !sourceMeta.height) throw new Error(`${layer.src}: image has no dimensions`);
        const layerWidth = Math.max(1, Math.round(width * anchor.width));
        const layerHeight = Math.max(1, Math.round((layerWidth * sourceMeta.height) / sourceMeta.width));
        const left = Math.round(anchor.x * width - layerWidth / 2);
        const top = Math.round(anchor.y * height - layerHeight / 2);
        composites.push({
          input: await sharp(source).resize(layerWidth, layerHeight).png().toBuffer(),
          left,
          top,
        });
      }
      const output = entry.variants?.[viewport] ?? `media/slots/${slotName}-${viewport}.png`;
      const finalDestination = await outputPath(publicRoot, output);
      if (protectedSources.has(finalDestination)) throw new Error(`${output}: output cannot replace a source image`);
      const canvas = sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
      await canvas.composite(composites).png().toFile(finalDestination);
      // Return manifest-relative paths so callers can display a stable result.
      written.push(output);
    }
  }
  return written;
}
