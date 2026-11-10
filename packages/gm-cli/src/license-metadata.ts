import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { licenseFor, type ResolvedCard } from '@ogm/asset-cards';
import { assetCreditSchema, type AssetCredit } from '@ogm/contracts';

import { collectionParts } from './resolve.js';

type CreditFields = {
  license?: unknown;
  license_source?: unknown;
  licenseSource?: unknown;
  attribution?: unknown;
  source?: unknown;
};

const invalidPackDocument = Symbol('invalid pack document');

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function source(value: unknown): AssetCredit['source'] | null {
  if (typeof value === 'string' && value.trim() !== '') {
    const trimmed = value.trim();
    return /^https?:\/\//.test(trimmed) ? { label: trimmed, url: trimmed } : { label: trimmed };
  }
  const input = record(value);
  if (input === null) return null;
  const label = [input.label, input.vendor, input.drop, input.url].find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '',
  );
  if (label === undefined) return null;
  const url = typeof input.url === 'string' && input.url.trim() !== '' ? input.url.trim() : undefined;
  return { label: label.trim(), ...(url === undefined ? {} : { url }) };
}

function normalize(
  value: unknown,
  pack: string,
  title: string,
  expectedLicense: string,
): { credit?: AssetCredit; detail?: string } {
  const fields = record(value) as CreditFields | null;
  const licenseSource = fields?.license_source ?? fields?.licenseSource;
  const normalizedSource = source(fields?.source);
  const missing = [
    ...(typeof fields?.license === 'string' && fields.license.trim() !== '' ? [] : ['license']),
    ...(typeof licenseSource === 'string' && licenseSource.trim() !== '' ? [] : ['license_source']),
    ...(typeof fields?.attribution === 'string' && fields.attribution.trim() !== '' ? [] : ['attribution']),
    ...(normalizedSource === null ? ['source'] : []),
  ];
  if (missing.length > 0) return { detail: `credit metadata is missing ${missing.join(', ')}` };
  const declaredLicense = (fields!.license as string).trim();
  const canonicalLicense = licenseFor(declaredLicense)?.id ?? declaredLicense;
  const canonicalExpected = licenseFor(expectedLicense)?.id ?? expectedLicense;
  if (canonicalLicense !== canonicalExpected) {
    return { detail: `credit metadata license ${declaredLicense} differs from ${expectedLicense}` };
  }
  const parsed = assetCreditSchema.safeParse({
    pack,
    title,
    licenseSource: (licenseSource as string).trim(),
    attribution: (fields!.attribution as string).trim(),
    source: normalizedSource,
  });
  return parsed.success
    ? { credit: parsed.data }
    : { detail: `credit metadata is invalid: ${parsed.error.issues[0]?.message}` };
}

async function packDocument(assetsRoot: string, slug: string): Promise<unknown | null | typeof invalidPackDocument> {
  try {
    return JSON.parse(await readFile(join(assetsRoot, 'packs', slug, 'pack.json'), 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return invalidPackDocument;
  }
}

function cardCreditFields(card: ResolvedCard, collection: ResolvedCard): CreditFields {
  const declared = card.rights ?? collection.rights;
  const license = card.license ?? collection.license;
  const licenseSource = declared?.basis.find((basis) => basis.type === 'license' && basis.ref)?.ref;
  const attribution = declared?.attribution ?? declared?.basis.find((basis) => basis.type === 'license')?.attribution;
  const vendor = collection.collection_info?.vendor;
  return {
    license,
    license_source: licenseSource,
    attribution: attribution === null ? 'none required' : attribution,
    source: vendor === undefined ? undefined : { label: vendor },
  };
}

function withCardFallback(pack: unknown, card: CreditFields): unknown {
  const fields = record(pack) as CreditFields | null;
  if (fields === null) return pack;
  const licenseSource = fields.license_source === undefined ? fields.licenseSource : fields.license_source;
  return {
    license: fields.license === undefined ? card.license : fields.license,
    license_source: licenseSource === undefined ? (card.license_source ?? card.licenseSource) : licenseSource,
    attribution: fields.attribution === undefined ? card.attribution : fields.attribution,
    source: fields.source === undefined ? card.source : fields.source,
  };
}

/** Resolve explicit legal metadata from the asset card, collection card, or its pack manifest. */
export async function creditForCard(
  assetsRoot: string,
  card: ResolvedCard,
  collection: ResolvedCard,
): Promise<{ credit?: AssetCredit; detail?: string }> {
  const { slug } = collectionParts(card.id);
  const pack = await packDocument(assetsRoot, slug);
  const cardFields = cardCreditFields(card, collection);
  const value = pack === null ? cardFields : withCardFallback(pack, cardFields);
  return normalize(value, slug, collection.title, card.resolved.license);
}

export function madeForGameCredit(gameId: string): AssetCredit {
  return {
    pack: `${gameId}:made`,
    title: 'Made for this game',
    licenseSource: 'created for this game',
    attribution: 'none required',
    source: { label: 'agent-generated' },
  };
}

export function derivedCredit(gameId: string, sources: readonly AssetCredit[]): AssetCredit {
  if (sources.length === 0) return madeForGameCredit(gameId);
  const unique = (values: string[]) => [...new Set(values)].sort();
  const attributions = unique(sources.map((item) => item.attribution).filter((item) => item !== 'none required'));
  return {
    pack: `${gameId}:derived:${unique(sources.map((item) => item.pack)).join('+')}`,
    title: 'Derived for this game',
    licenseSource: unique(sources.map((item) => item.licenseSource)).join('; '),
    attribution: attributions.length === 0 ? 'none required' : attributions.join('; '),
    source: { label: `derived from ${unique(sources.map((item) => item.pack)).join(', ')}` },
  };
}
