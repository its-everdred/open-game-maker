import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(gameRoot, 'public', 'assets-local');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const assetsRootArg = option('--assets-root');
if (!assetsRootArg) throw new Error('usage: pnpm prepare:assets -- --assets-root <authorized-assets-root>');
const assetsRoot = resolve(assetsRootArg);

function contained(root, path) {
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) throw new Error(`path escapes asset root: ${path}`);
  return resolved;
}

async function digest(path) {
  return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
}

const ISO = 'smallscaleint-fantasy-tileset-2d-isometric';
const tile = (slug, file) => [
  `${slug}.png`,
  ISO,
  `tiles/environment/${slug}.card.json`,
  `t1:${ISO}/tiles/environment/${slug}@2026-11-01`,
  `Environment/${file}`,
];

const carded = [
  tile('ground-a1', 'Ground A1_E.png'),
  tile('ground-a2', 'Ground A2_E.png'),
  tile('tree-a1', 'Tree A1_E.png'),
  tile('tree-a2', 'Tree A2_E.png'),
  tile('tree-a3', 'Tree A3_E.png'),
  tile('tree-e4', 'Tree E4_E.png'),
  tile('stone-a1', 'Stone A1_E.png'),
  tile('stone-a3', 'Stone A3_E.png'),
  tile('stone-a12', 'Stone A12_E.png'),
  [
    'hero-idle.png',
    'smallscaleint-2d-hd-character-knight',
    'characters/knight.card.json',
    't1:smallscaleint-2d-hd-character-knight/characters/knight@2026-11-01',
    'Spritesheets/With shadows/Idle.png',
  ],
];

// The pack's fireplace has no asset card yet, so its digest is pinned here.
const pinned = [
  [
    'fireplace.png',
    ISO,
    'Environment/FirePlace.png',
    'sha256:43d5fb4df95ec83e24829af757e4f47c88d73e47af87feb19ca70f97a29af8bb',
  ],
];

const manifest = { version: 1, set: 'smallscaleint', assets: [] };

async function copyChecked(output, pack, sourcePath, sha256, cardId) {
  const input = contained(contained(assetsRoot, join('packs', pack)), join('2026-11-01', 'extracted', sourcePath));
  const actual = await digest(input);
  if (actual !== sha256) throw new Error(`sha256 mismatch for ${pack}: ${sourcePath}`);
  const destination = contained(outputRoot, output);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(input, destination);
  manifest.assets.push({ output, ...(cardId ? { cardId } : { pack }), sourcePath, sha256: actual });
}

for (const [output, pack, cardPath, cardId, sourcePath] of carded) {
  const packRoot = contained(assetsRoot, join('packs', pack));
  const card = JSON.parse(await readFile(contained(packRoot, join('cards', cardPath)), 'utf8'));
  if (card.id !== cardId) throw new Error(`card id mismatch for ${cardPath}: ${card.id}`);
  const source = card.source?.files?.find((file) => file.path === sourcePath);
  if (!source?.sha256) throw new Error(`source is not locked on ${cardId}: ${sourcePath}`);
  await copyChecked(output, pack, sourcePath, source.sha256, cardId);
}

for (const [output, pack, sourcePath, sha256] of pinned) await copyChecked(output, pack, sourcePath, sha256);

await writeFile(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`prepared ${manifest.assets.length} verified private assets`);
