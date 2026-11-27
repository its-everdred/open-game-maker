/** Make the inspected shallow entrance from the licensed Wall A12 south view. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { makeWallA12Steps } from './wall-a12-steps.ts';

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg || process.argv.length !== 4) {
  throw new Error('Usage: node derive-wall-a12-steps.ts <Wall A12_S.png> <new-output-directory>');
}
const source = await realpath(sourceArg);
const parent = await realpath(dirname(resolve(outputArg)));
const output = join(parent, basename(resolve(outputArg)));
const segments = source.split(sep);
const extracted = segments.lastIndexOf('extracted');
if (extracted < 1) throw new Error('Source must be an extracted pack file');
const packRoot = segments.slice(0, extracted).join(sep) || sep;
const fromPack = relative(packRoot, output);
const outputParts = output.split(sep);
if (
  fromPack === '' ||
  (!fromPack.startsWith(`..${sep}`) && fromPack !== '..') ||
  outputParts.includes('originals') ||
  outputParts.includes('extracted') ||
  output.includes(`${sep}assets-local${sep}packs${sep}`)
) {
  throw new Error('Output must be outside the source pack and all pack originals and extracted files');
}
const sourceBytes = await readFile(source);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== 'bbe9293b1e6b8595986c350dedfe1c975527bfd5fde25595a875fa1ab9ba6560') {
  throw new Error('Source hash does not match the measured Wall A12 south view');
}
const png = await makeWallA12Steps(sourceBytes);
await mkdir(output);
await writeFile(join(output, 'chapel-steps-s.png'), png, { flag: 'wx' });
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify({
    name: 'chapel-steps-s',
    derived_from: 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/wall-a12@2026-11-01',
    source_sha256: sourceSha256,
    output_sha256: createHash('sha256').update(png).digest('hex'),
    operation: 'Cut the south-facing staircase at y = 196 + (x - 128) / 2; shift left 5 and down 28 pixels.',
    rights: 'Inherits the source card rights; do not redistribute the source or variant as standalone files.',
    status: 'provisional',
  }, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(`Wrote provisional variant and provenance to ${output}`);
