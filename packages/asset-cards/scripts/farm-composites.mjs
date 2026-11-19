#!/usr/bin/env node
/** Compose the vendor's aligned farmer sheets without modifying the originals. */
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const examples = [
  ['Body_1.png', 'Hairstyle_Short_Blonde.png', 'Outfit_Dungarees_Red.png'],
  ['Body_2.png', 'Hairstyle_Short_Brown_Dark.png', 'Outfit_Dungarees_Green.png'],
  ['Body_3.png', 'Hairstyle_Long_Gray.png', 'Outfit_Dungarees_Black.png'],
];

async function rejectSymlink(path) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`output is a symlink: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function compose(pack, version = '1.3') {
  const extracted = resolve(pack, version, 'extracted');
  const pieces = join(extracted, 'Farmer_Generator_Pieces');
  const output = resolve(pack, 'sheets');
  await mkdir(output, { recursive: true });
  const actualOutput = await realpath(output);
  if (actualOutput !== join(await realpath(pack), 'sheets')) throw new Error('output directory is a symlink');
  const outputFromOriginals = relative(await realpath(extracted), actualOutput);
  if (!outputFromOriginals.startsWith(`..${sep}`)) throw new Error('output overlaps originals');
  const folders = ['Bodies', 'Hairstyles', 'Outfits'];
  const results = [];
  for (const [index, selection] of examples.entries()) {
    const paths = selection.map((name, i) => join(pieces, 'Character Pieces', folders[i], '32x32', name));
    const dimensions = await Promise.all(paths.map((path) => sharp(path).metadata()));
    if (dimensions.some((item) => item.width !== dimensions[0].width || item.height !== dimensions[0].height)) {
      throw new Error('farmer layers have incompatible dimensions');
    }
    const filename = `farmer-example-${index + 1}.png`;
    await rejectSymlink(join(output, filename));
    await sharp(paths[0]).composite(paths.slice(1).map((input) => ({ input, blend: 'over' }))).png().toFile(join(output, filename));
    results.push({ file: filename, layers: paths.map((path) => relative(extracted, path).split(sep).join('/')) });
  }
  const manifest = {
    order: ['body', 'hair', 'clothes', 'tools'],
    note: 'Body, hair and clothes share a sheet grid. Tool sheets have different dimensions and need animation-specific alignment.',
    examples: results,
  };
  await rejectSymlink(join(output, 'farmer-layers.json'));
  await writeFile(join(output, 'farmer-layers.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('usage: node farm-composites.mjs <pack-directory> [version]');
  await compose(process.argv[2], process.argv[3]);
}
