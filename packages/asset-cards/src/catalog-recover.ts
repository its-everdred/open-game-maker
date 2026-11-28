import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import { effectiveRights, rightsAgree, validateCardRights } from '@ogm/contracts';
import { z } from 'zod';

import { catalogKind } from './catalog-kind.js';
import { catalogMediaRefs, type CatalogMediaRole } from './catalog-media.js';
import type { CatalogAsset, CatalogIndex } from './catalog.js';
import { intersectRights } from './resolve.js';
import type { CardIndex, Rights } from './types.js';

const path = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..'));
const preview = z
  .object({
    thumb: path.optional(),
    sheet: path.optional(),
    waveform: path.optional(),
    clip: path.optional(),
    specimen: path.optional(),
    diorama: path.optional(),
    loop: path.optional(),
  })
  .optional();
const status = z.enum(['draft', 'measured', 'tagged', 'reviewed', 'quarantined', 'rejected']);
const cardSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  card_type: z.literal('asset'),
  status,
  kind: z.string(),
  subkind: z.string().optional(),
  collection: z.string(),
  rights: z.unknown().optional(),
  license: z.string().optional(),
  previews: preview,
  source: z.object({ files: z.array(z.object({ path, role: z.string() })) }).optional(),
  generation: z.object({ method: z.literal('ai') }).optional(),
  anim: z
    .object({
      clips: z.array(
        z.object({ name: z.string(), duration_s: z.number().nonnegative(), loop: z.boolean().optional() }),
      ),
    })
    .optional(),
});
const collectionSchema = z.object({
  id: z.string(),
  card_type: z.literal('collection'),
  status,
  rights: z.unknown(),
  license: z.string().optional(),
  generation: z.object({ method: z.literal('ai') }).optional(),
});

export type RecoveredMedia = {
  rights: Rights;
  previews: Partial<Record<Exclude<CatalogMediaRole, 'source'>, string>>;
  sourcePath?: string;
};

async function readInside(root: string, file: string): Promise<string> {
  const base = await realpath(root);
  const candidate = join(base, file);
  const [info, resolved] = await Promise.all([lstat(candidate), realpath(candidate)]);
  const within = relative(base, resolved);
  if (!info.isFile() || info.isSymbolicLink() || within.startsWith('..') || isAbsolute(within)) {
    throw new Error('card path leaves library');
  }
  return readFile(resolved, 'utf8');
}

function rightsOf(value: unknown): Rights | undefined {
  const validated = validateCardRights(value);
  if (!validated.ok) return;
  try {
    const rights = effectiveRights(validated.rights.basis);
    if (!rightsAgree(validated.rights, rights)) return;
    return { uses: [...rights.uses].sort(), audience: rights.audience, redistribution: rights.redistribution };
  } catch {
    return;
  }
}

/** Recover usable fields only when unsupported metadata made a card fail full validation. Rights still use the strict schema. */
export async function recoverCatalogCards(root: string, cards: CardIndex, catalogue: CatalogIndex): Promise<void> {
  const packs = new Map(catalogue.packs.map((pack) => [pack.id, pack]));
  const known = new Set(catalogue.assets.map((asset) => asset.id));
  for (const error of cards.errors) {
    const match = /^packs\/([a-z0-9][a-z0-9-]*)\/cards\/(.+\.card\.json)$/.exec(error.path);
    if (!match || match[2]!.split('/').includes('..')) continue;
    const pack = packs.get(match[1]!);
    if (!pack) continue;
    try {
      const [input, parentInput] = await Promise.all([
        readInside(root, error.path),
        readInside(root, join('packs', pack.id, 'collection.card.json')),
      ]);
      const parsed = cardSchema.safeParse(JSON.parse(input));
      const parent = collectionSchema.safeParse(JSON.parse(parentInput));
      if (!parsed.success || !parent.success) continue;
      const card = parsed.data;
      if (
        !card.id.startsWith(`t1:${pack.id}/`) ||
        card.collection !== parent.data.id ||
        !parent.data.id.startsWith(`t1:${pack.id}@`) ||
        known.has(card.id)
      )
        continue;
      if (['quarantined', 'rejected'].includes(card.status) || ['quarantined', 'rejected'].includes(parent.data.status))
        continue;
      const parentRights = rightsOf(parent.data.rights);
      const own = card.rights === undefined ? undefined : rightsOf(card.rights);
      if (!parentRights || (card.rights !== undefined && !own)) continue;
      const effective = own ? intersectRights(parentRights, own) : parentRights;
      const declared = validateCardRights(card.rights ?? parent.data.rights);
      if (!declared.ok) continue;
      const rights = { ...effective, attribution: declared.rights.attribution ?? null };
      const kind = catalogKind(card.kind, card.subkind);
      const version = /@([^@/]+)$/.exec(card.id)?.[1];
      if (!kind || !version || version === '.' || version === '..') continue;
      const primary = card.source?.files.find((file) => file.role === 'primary');
      const sourcePath = primary ? join('packs', pack.id, version, 'extracted', primary.path) : undefined;
      const previews = card.previews ?? {};
      const asset: CatalogAsset = {
        id: card.id,
        title: card.title,
        kind,
        pack: { id: pack.id, vendor: pack.vendor, title: pack.title, storeUrl: pack.storeUrl },
        license: card.license ?? parent.data.license ?? 'NOASSERTION',
        rights,
        aiGenerated: (card.generation ?? parent.data.generation)?.method === 'ai',
        style: null,
        tags: [],
        previews: catalogMediaRefs(card.id, previews, !!sourcePath && rights.uses.includes('in-game')),
        usedIn: [],
        clips: card.anim?.clips ?? [],
      };
      catalogue.assets.push(asset);
      catalogue.recovered.set(card.id, { rights, previews, sourcePath });
      known.add(card.id);
    } catch {
      /* Invalid or missing inputs are omitted rather than widening rights. */
    }
  }
}
