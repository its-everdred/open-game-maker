import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { measureFont, measureGltf, measureImage } from '@ogm/asset-measure';
import { validateCard, type AssetCard } from '@ogm/contracts';

import type { Item } from './identify.js';
import type { Vendor } from './vendor.js';
import { writeThumbnail } from './previews.js';

export type CardSet = {
  collection: AssetCard;
  assets: AssetCard[];
  validationErrors: Array<{ id: string; errors: string[] }>;
};

type CreateCardsOptions = {
  assetsRoot: string;
  top: 'packs' | 'inspiration';
  id: string;
  title: string;
  version: string;
  tier: 1 | 2;
  vendor: Vendor;
  displayVendor?: string;
  origin: 'vendor-pack' | 'drive-drop' | 'mirror';
  extracted: string;
  items: Item[];
  filesTotal: number;
  hashManifest: string;
  date: string;
};

const VOCAB = '2026-11-01';

function titleFor(path: string): string {
  return basename(path, extname(path))
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 120);
}

function slugFor(path: string): string {
  const stem = path.slice(0, path.length - extname(path).length);
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function descriptionFor(path: string): string {
  const title = titleFor(path);
  return title.length >= 10 ? title : `${title} game asset`;
}

type SourceFacts = { path: string; sha256: string; bytes: number; format: string };

async function sourceFile(
  root: string,
  path: string,
  role: 'primary' | 'texture' | 'metadata',
  cache: Map<string, SourceFacts>,
) {
  let facts = cache.get(path);
  if (!facts) {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(join(root, path))) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    facts = {
      path,
      sha256: `sha256:${hash.digest('hex')}`,
      bytes,
      format: extname(path).slice(1).toLowerCase() || 'bin',
    };
    cache.set(path, facts);
  }
  return {
    ...facts,
    role,
  } as const;
}

function defaultRights(date: string): NonNullable<AssetCard['rights']> {
  return {
    uses: ['vision-input'],
    audience: 'private',
    redistribution: 'none',
    attribution: null,
    processing: 'local-only',
    basis: [
      {
        type: 'default',
        uses: ['vision-input'],
        audience: 'private',
        redistribution: 'none',
        attribution: null,
        set_by: { role: 'intake-code' },
        date,
        note: 'Strict intake default until a named human confirms the license.',
      },
    ],
  };
}

async function measuredFields(item: Item, file: string): Promise<Partial<AssetCard>> {
  const extension = extname(file).slice(1).toLowerCase();
  if (extension === 'glb' || extension === 'gltf') {
    const measured = await measureGltf(file);
    return { kind: 'model', geometry: measured.geometry, ...(measured.rig ? { rig: measured.rig } : {}) };
  }
  if (['fbx', 'obj', 'blend', 'dae', '3ds', 'stl', 'ply', 'usd', 'usdz', 'vox'].includes(extension)) {
    return { kind: 'model', flags: ['needs-conversion'] };
  }
  if (item.kind === 'ui' && item.subkind === 'font') {
    return { font: await measureFont(file) };
  }
  if (item.kind === 'sprite' || item.kind === 'texture' || item.kind === 'ui' || item.kind === 'vfx') {
    const measured = await measureImage(file);
    if (item.kind === 'texture')
      return { image: measured.image, look: measured.look, texture: { maps: [], tileable: false } };
    if (item.kind === 'vfx') return { image: measured.image, look: measured.look, vfx: { blend: 'alpha' } };
    if (item.kind === 'ui') return { image: measured.image, look: measured.look };
    return {
      image: measured.image,
      look: measured.look,
      sprite: { drawn_view: 'none', ...(item.vendor?.tilePx ? { tile_px: item.vendor.tilePx } : {}) },
    };
  }
  return { flags: ['needs-review'] };
}

function withValidation(card: AssetCard, errors: CardSet['validationErrors']): AssetCard {
  const result = validateCard(card);
  if (result.ok) return card;
  card.flags = [...new Set<NonNullable<AssetCard['flags']>[number]>([...(card.flags ?? []), 'needs-review'])];
  errors.push({ id: card.id, errors: result.errors });
  return card;
}

export async function createCards(options: CreateCardsOptions): Promise<CardSet> {
  const at = `${options.date}T00:00:00.000Z`;
  const collectionId = `t${options.tier}:${options.id}@${options.version}`;
  const counts: Record<string, number> = {};
  for (const item of options.items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    if (item.subkind) counts[`${item.kind}/${item.subkind}`] = (counts[`${item.kind}/${item.subkind}`] ?? 0) + 1;
  }
  const validationErrors: CardSet['validationErrors'] = [];
  const collection = withValidation(
    {
      schema: 'ogm.asset-card/1.1',
      vocab: VOCAB,
      id: collectionId,
      card_type: 'collection',
      status: 'quarantined',
      title: options.title,
      license: 'NOASSERTION',
      rights: defaultRights(options.date),
      collection_info: {
        vendor: options.displayVendor ?? options.vendor,
        version: options.version,
        origin: options.origin,
        counts,
        pack_manifest: `${options.top}/${options.id}/pack.json`,
        hash_manifest: `${options.top}/${options.id}/${options.version}/${options.hashManifest}`,
        files_total: options.filesTotal,
      },
      provenance: { '*': { by: 'code', tool: 'gm-intake@0.1', at } },
    },
    validationErrors,
  );

  const assets: AssetCard[] = [];
  const usedIds = new Set<string>();
  const sourceFacts = new Map<string, SourceFacts>();
  for (const item of options.items) {
    const primary = await sourceFile(options.extracted, item.path, 'primary', sourceFacts);
    const companions = await Promise.all(
      item.companions.map((path) =>
        sourceFile(
          options.extracted,
          path,
          /^MaterialList_.*\.txt$/i.test(basename(path)) ? 'metadata' : 'texture',
          sourceFacts,
        ),
      ),
    );
    const measured: Partial<AssetCard> = await measuredFields(item, join(options.extracted, item.path)).catch(() => ({
      flags: ['needs-review'],
    }));
    let localId = slugFor(item.path) || primary.sha256.slice(7, 19);
    if (localId.length > 180) localId = `${localId.slice(0, 160)}-${primary.sha256.slice(7, 19)}`;
    const baseId = localId;
    if (usedIds.has(localId)) localId = `${baseId}-${primary.sha256.slice(7, 15)}`;
    let suffix = 2;
    while (usedIds.has(localId)) {
      localId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(localId);
    const thumbnail = await writeThumbnail(
      options.assetsRoot,
      join(options.extracted, item.path),
      primary.sha256.slice(7),
      options.vendor === 'synty',
    ).catch(() => undefined);
    const card = withValidation(
      {
        schema: 'ogm.asset-card/1.1',
        vocab: VOCAB,
        id: `t${options.tier}:${options.id}/${localId}@${options.version}`,
        card_type: 'asset',
        status: measured.geometry || measured.image || measured.font ? 'measured' : 'draft',
        title: titleFor(item.path),
        kind: item.kind,
        ...(item.subkind ? { subkind: item.subkind } : {}),
        collection: collectionId,
        source: { files: [primary, ...companions], content_hash: primary.sha256 },
        describe: { description: descriptionFor(item.path) },
        ...(thumbnail ? { previews: { thumb: thumbnail } } : {}),
        ...measured,
        provenance: {
          '*': { by: 'code', tool: 'gm-intake@0.1', at },
          describe: { by: 'filename', tool: 'gm-intake@0.1', at },
          ...(item.vendor?.tilePx
            ? {
                'sprite.tile_px': {
                  by: 'vendor-metadata' as const,
                  tool: 'gm-intake@0.1',
                  at,
                  input: 'Tilesheet.txt',
                },
              }
            : {}),
        },
      },
      validationErrors,
    );
    assets.push(card);
  }
  return { collection, assets, validationErrors };
}
