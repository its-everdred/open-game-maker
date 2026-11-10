#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import sharp from 'sharp';

import {
  ATLAS_COLLECTION_ID,
  ATLAS_GENERATION,
  ATLAS_PACK,
  ATLAS_VERSION,
  AtlasArrayReader,
  atlasDatabasePath,
  atlasExtractedRoot,
  atlasSubjectTag,
  assertAtlasText,
  buildAtlasDatabase,
} from '../dist/index.js';

const EXPECTED_ROWS = 1_409_404;
const EXPECTED_SUBJECTS = 6_194;
const cardsOnly = process.argv.includes('--cards-only');
const rootArgument = process.argv.slice(2).find((argument) => !argument.startsWith('-'));
const assetsRoot = resolve(rootArgument ?? process.env.OGM_ASSETS_ROOT ?? 'assets-local');
const packRoot = join(assetsRoot, 'packs', ATLAS_PACK);
const versionRoot = join(packRoot, ATLAS_VERSION);
const extractedRoot = atlasExtractedRoot(assetsRoot);
const cardsTreeRoot = join(packRoot, 'cards');
const cardsRoot = join(cardsTreeRoot, 'subjects');
const sheetsRoot = join(versionRoot, 'contact-sheets');
const fixedAt = '2026-11-09T00:00:00Z';

function slug(subject) {
  const stem = subject
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56) || 'subject';
  return `${stem}-${createHash('sha1').update(subject).digest('hex').slice(0, 8)}`;
}

function escapeXml(value) {
  return value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

async function shaRecord(path, name, format) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return {
    path: name,
    sha256: `sha256:${hash.digest('hex')}`,
    bytes: (await stat(path)).size,
    format,
  };
}

async function writeContactSheet(reader, subject, rows, path) {
  const columns = 8;
  const cell = 16;
  const bodyRows = Math.max(1, Math.ceil(rows.length / columns));
  const native = Buffer.alloc(columns * cell * bodyRows * cell * 4);
  for (let at = 0; at < rows.length; at += 1) {
    const sprite = reader.readRgba(rows[at]);
    const left = (at % columns) * cell;
    const top = Math.floor(at / columns) * cell;
    for (let y = 0; y < cell; y += 1) {
      sprite.copy(native, ((top + y) * columns * cell + left) * 4, y * cell * 4, (y + 1) * cell * 4);
    }
  }
  const body = await sharp(native, {
    raw: { width: columns * cell, height: bodyRows * cell, channels: 4 },
  })
    .resize(columns * cell * 4, bodyRows * cell * 4, { kernel: 'nearest' })
    .png()
    .toBuffer();
  const width = columns * cell * 4;
  const header = Buffer.from(
    `<svg width="${width}" height="32"><rect width="100%" height="100%" fill="#17141f"/>` +
      `<text x="9" y="13" font-family="sans-serif" font-size="11" font-weight="700" fill="#ffcf66">AI-GENERATED · KREA 2 TURBO</text>` +
      `<text x="9" y="27" font-family="sans-serif" font-size="12" fill="#ffffff">${escapeXml(subject).slice(0, 72)}</text></svg>`,
  );
  await sharp({ create: { width, height: 32 + bodyRows * cell * 4, channels: 4, background: '#17141f' } })
    .composite([
      { input: header, left: 0, top: 0 },
      { input: body, left: 0, top: 32 },
    ])
    .png()
    .toFile(path);
}

const [captions, subjects] = await Promise.all(
  ['captions.json', 'objects.json'].map(async (name) => JSON.parse(await readFile(join(extractedRoot, name), 'utf8'))),
);
if (!Array.isArray(captions) || !Array.isArray(subjects) || captions.length !== EXPECTED_ROWS || subjects.length !== EXPECTED_ROWS) {
  throw new Error(`Atlas metadata must contain ${EXPECTED_ROWS} parallel caption and subject rows`);
}
if (!captions.every((value) => typeof value === 'string') || !subjects.every((value) => typeof value === 'string')) {
  throw new Error('Atlas captions and subjects must be strings');
}

const reader = new AtlasArrayReader(extractedRoot);
if (reader.rowCount !== EXPECTED_ROWS) throw new Error(`tokens.npy has ${reader.rowCount} rows, expected ${EXPECTED_ROWS}`);

const bySubject = new Map();
for (let row = 0; row < subjects.length; row += 1) {
  const subject = assertAtlasText(subjects[row], `subject for row ${row}`);
  assertAtlasText(captions[row], `caption for row ${row}`);
  const held = bySubject.get(subject) ?? { count: 0, rows: [] };
  held.count += 1;
  if (held.rows.length < 24) held.rows.push(row);
  bySubject.set(subject, held);
}
if (bySubject.size !== EXPECTED_SUBJECTS) {
  reader.close();
  throw new Error(`Atlas has ${bySubject.size} subjects, expected ${EXPECTED_SUBJECTS}`);
}

const subjectSlugs = new Map([...bySubject.keys()].map((subject) => [subject, slug(subject)]));
const storageFiles = await Promise.all([
  shaRecord(join(extractedRoot, 'tokens.npy'), 'tokens.npy', 'npy'),
  shaRecord(join(extractedRoot, 'palette.npy'), 'palette.npy', 'npy'),
  shaRecord(join(extractedRoot, 'captions.json'), 'captions.json', 'json'),
  shaRecord(join(extractedRoot, 'objects.json'), 'objects.json', 'json'),
]);

await rm(cardsRoot, { recursive: true, force: true });
if (!cardsOnly) await rm(sheetsRoot, { recursive: true, force: true });
await mkdir(cardsRoot, { recursive: true });
await mkdir(sheetsRoot, { recursive: true });
await writeFile(
  join(cardsTreeRoot, '.indexignore'),
  'Atlas subject summaries are browse-only; individual rows are searched in atlas.sqlite.\n',
);

let written = 0;
for (const [subject, details] of [...bySubject].sort(([left], [right]) => left.localeCompare(right))) {
  const subjectSlug = subjectSlugs.get(subject);
  const sheetRelative = `packs/${ATLAS_PACK}/${ATLAS_VERSION}/contact-sheets/${subjectSlug}.png`;
  if (!cardsOnly) await writeContactSheet(reader, subject, details.rows, join(sheetsRoot, `${subjectSlug}.png`));
  const card = {
    schema: 'ogm.asset-card/1.2',
    vocab: '2026-11-09',
    id: `t1:${ATLAS_PACK}/subjects/${subjectSlug}@${ATLAS_VERSION}`,
    card_type: 'asset',
    status: 'measured',
    title: subject,
    kind: 'sprite',
    subkind: 'item',
    collection: ATLAS_COLLECTION_ID,
    source: { files: storageFiles.map((file) => ({ ...file, role: 'metadata' })) },
    previews: { sheet: sheetRelative },
    describe: {
      description: `${details.count.toLocaleString('en-US')} approximate-caption sprites. Subject: ${subject}.`,
      objects: [atlasSubjectTag(subject)],
      roles: ['icon'],
    },
    image: { width_px: 16, height_px: 16, has_alpha: true, pixel_art: true },
    sprite: { drawn_view: 'none', tile_px: 16, sheet_index: details.rows[0] },
    generation: ATLAS_GENERATION,
    provenance: {
      '*': { by: 'code', tool: 'ogm-atlas-index@1', at: fixedAt, input: 'objects.json + tokens.npy' },
      generation: { by: 'collection', at: fixedAt, input: 'collection generation marker' },
    },
  };
  await writeFile(join(cardsRoot, `${subjectSlug}.card.json`), `${JSON.stringify(card, null, 2)}\n`);
  written += 1;
  if (written % 250 === 0) process.stdout.write(`contact sheets and cards: ${written}/${EXPECTED_SUBJECTS}\n`);
}
reader.close();

if (!cardsOnly) buildAtlasDatabase(atlasDatabasePath(assetsRoot), { captions, subjects, storageFiles });

const firstSheet = `packs/${ATLAS_PACK}/${ATLAS_VERSION}/contact-sheets/${subjectSlugs.get([...bySubject.keys()].sort()[0])}.png`;
const rightsBasis = {
  type: 'license',
  license: 'CC0-1.0',
  ref: '1.4m/originals/LICENSE + 1.4m/originals/README.md',
  uses: ['in-game', 'placeholder', 'style-reference', 'vision-input'],
  audience: 'public',
  redistribution: 'free',
  attribution: null,
  set_by: { role: 'intake-code' },
  confirmed_by: 'kevin',
  date: '2026-11-09',
  note: "CC0 to the extent of Angais's rights; Krea 2 Community License and Acceptable Use Policy still apply.",
};
const collection = {
  schema: 'ogm.asset-card/1.2',
  vocab: '2026-11-09',
  id: ATLAS_COLLECTION_ID,
  card_type: 'collection',
  status: 'tagged',
  title: 'Pixel Art Atlas — 1.4M Synthetic Sprites (Angais)',
  license: 'CC0-1.0',
  rights: {
    uses: rightsBasis.uses,
    audience: rightsBasis.audience,
    redistribution: rightsBasis.redistribution,
    attribution: null,
    basis: [rightsBasis],
  },
  generation: ATLAS_GENERATION,
  previews: { sheet: firstSheet },
  describe: {
    description: 'Native 16x16 transparent pixel-art sprites with approximate English captions.',
    objects: ['sprite', 'icon'],
    roles: ['icon'],
    style_family: 'pixel-art',
    set: 'angais-pixel-art-atlas',
    pov_fit: ['topdown', 'side', 'fixed'],
    settings: ['none'],
  },
  collection_info: {
    vendor: 'angais',
    version: ATLAS_VERSION,
    origin: 'mirror',
    counts: { 'sprite/item': EXPECTED_ROWS },
    family_coverage: { characters: true, environment: true, props: true, ui: true, sfx: false, music: false },
    creation_choice: false,
    pack_manifest: `assets-local/packs/${ATLAS_PACK}/pack.json`,
    search_summary: `${EXPECTED_ROWS.toLocaleString('en-US')} AI-generated native 16x16 sprites across ${EXPECTED_SUBJECTS.toLocaleString('en-US')} approximate-caption subjects.`,
    files_total: 6,
  },
  provenance: {
    '*': { by: 'code', tool: 'ogm-atlas-index@1', at: fixedAt, input: 'dataset arrays and local licence files' },
    rights: { by: 'license', tool: 'ogm-asset-intake@1', at: fixedAt, input: rightsBasis.ref },
    generation: { by: 'vendor-metadata', at: fixedAt, input: 'dataset README generation disclosure' },
  },
};
await writeFile(join(packRoot, 'collection.card.json'), `${JSON.stringify(collection, null, 2)}\n`);

const usageRights = {
  uses: rightsBasis.uses,
  audience: 'public',
  redistribution: 'free',
  attribution: 'none required',
  processing: 'any',
  basis: rightsBasis.ref,
  confirmed_by: 'kevin',
  confirmed_on: '2026-11-09',
};
const pack = {
  id: ATLAS_PACK,
  vendor: 'angais',
  title: 'Pixel Art Atlas — 1.4M Synthetic Sprites',
  category: '2d',
  license: 'CC0-1.0',
  license_source: '1.4m/originals/LICENSE',
  attribution: 'none required',
  source: { label: 'Angais/pixel-art-atlas-1.4m' },
  requires: [],
  current: ATLAS_VERSION,
  versions: {
    [ATLAS_VERSION]: {
      format: 'zip+npy',
      extracted_files: 6,
      file_types: { npy: 3, json: 2, png: 1 },
      added: '2026-11-09',
      source: { type: 'local-drop', dataset: 'Angais/pixel-art-atlas-1.4m' },
      usage_rights: usageRights,
    },
  },
  notes: 'Captions are approximate. AI-generated with Krea 2 Turbo and a pixel-art LoRA; applicable Krea terms remain in force.',
};
await writeFile(join(packRoot, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
await writeFile(
  join(versionRoot, 'intake.json'),
  `${JSON.stringify(
    {
      status: 'imported',
      collection: ATLAS_PACK,
      license: 'CC0-1.0',
      usage_rights: usageRights,
      confirmed_by: 'kevin',
      date: '2026-11-09',
      tagging: 'indexed-from-dataset-metadata',
      notes: `${EXPECTED_ROWS} sprites remain in array storage; ${EXPECTED_SUBJECTS} subject cards and marked contact sheets generated.`,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(
  `built ${ATLAS_PACK}: ${EXPECTED_ROWS} indexed sprites, ${written} subject cards${cardsOnly ? '' : '/contact sheets'}\n`,
);
