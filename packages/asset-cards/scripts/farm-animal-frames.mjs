#!/usr/bin/env node
/** Extract the first frame only from recognized 24-column Modern Farm animal sheets. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, unlink } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

export function frameWidth(width) {
  return [32, 64, 96].includes(width / 24) ? width / 24 : null;
}

export function animalGeometry(name, width, height) {
  if (name === 'Dogs_Doghouse_Sleeping_32x32.png' && width === 512 && height === 858) return { width: 64, height: 96 };
  if (name === 'Duck_White_32x32.png' && width === 1658 && height === 256) return { width: 64, height: 64 };
  const frame = frameWidth(width);
  return frame && height >= frame ? { width: frame, height: frame } : null;
}

export async function hasPixels(input, frame, left = 0, top = 0) {
  const { data } = await sharp(input).extract({ left, top, width: frame, height: frame })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
  return false;
}

export async function animalOrigin(input, frame, frameHeight = frame) {
  const metadata = await sharp(input).metadata();
  for (let row = 0; row < 4 && (row + 1) * frameHeight <= metadata.height; row += 1) {
    for (let column = 0; column < 4 && (column + 1) * frame <= metadata.width; column += 1) {
      const left = column * frame, top = row * frameHeight;
      const { data } = await sharp(input).extract({ left, top, width: frame, height: frameHeight })
        .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let occupied = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) occupied += 1;
      if (occupied > 0 && occupied < frame * frameHeight * 0.9) return { left, top };
    }
  }
  return null;
}

export async function farmerOrigin(input) {
  const { data, info } = await sharp(input).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] !== 0) {
        return { left: Math.floor(x / 32) * 32, top: Math.floor(y / 32) * 32 };
      }
    }
  }
  throw new Error('farmer sheet has no visible pixels');
}

async function pngs(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await pngs(path)));
    else if (entry.isFile() && path.endsWith('.png')) result.push(path);
  }
  return result.sort();
}

export async function generate(pack, version = '1.3') {
  const extracted = resolve(pack, version, 'extracted');
  const animals = join(extracted, '32x32', 'Animals_32x32');
  const output = resolve(pack, 'sheets', 'lineup-thumbs');
  await mkdir(output, { recursive: true });
  const outputReal = await realpath(output);
  if (outputReal !== join(await realpath(pack), 'sheets', 'lineup-thumbs')) throw new Error('lineup output contains a symlink');
  if (!relative(await realpath(extracted), outputReal).startsWith(`..${sep}`)) throw new Error('lineup output overlaps originals');
  let written = 0;
  let skipped = 0;
  for (const input of await pngs(animals)) {
    const meta = await sharp(input).metadata();
    const geometry = animalGeometry(basename(input), meta.width, meta.height);
    if (!geometry) { skipped += 1; continue; }
    const key = relative(extracted, input).split(sep).join('/');
    const target = join(output, createHash('sha256').update(key).digest('hex') + '.png');
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error(`output is a symlink: ${target}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const origin = await animalOrigin(input, geometry.width, geometry.height);
    if (!origin) {
      await unlink(target).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      skipped += 1;
      continue;
    }
    await sharp(input).extract({ ...origin, ...geometry }).png().toFile(target);
    written += 1;
  }
  const characters = join(extracted, '32x32', 'Characters_32x32');
  const farmers = (await pngs(characters)).filter((path) => /Farmer_[12](?:_No_Hat)?_32x32\.png$/u.test(path));
  for (const input of farmers) {
    const key = relative(extracted, input).split(sep).join('/');
    const target = join(output, createHash('sha256').update(key).digest('hex') + '.png');
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error(`output is a symlink: ${target}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const origin = await farmerOrigin(input);
    const meta = await sharp(input).metadata();
    await sharp(input).extract({ ...origin, width: Math.min(128, meta.width - origin.left),
      height: Math.min(128, meta.height - origin.top) }).png().toFile(target);
    written += 1;
  }
  return { written, skipped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('usage: node farm-animal-frames.mjs <pack-directory> [version]');
  console.log(JSON.stringify(await generate(process.argv[2], process.argv[3])));
}
