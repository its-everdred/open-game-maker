import { readFile, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { validateCard, type AssetCard, type RightsBasis, type Use } from '@ogm/contracts';

import type { CardSet } from './cards.js';
import type { Item } from './identify.js';

export type LicenseMapEntry = { license: string; attribution: string | null; dropped?: string };
export type LicenseMap = Record<string, LicenseMapEntry>;

const LICENSES = new Set([
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC-BY-SA-3.0',
  'CC-BY-SA-4.0',
  'OGA-BY-3.0',
  'GPL-2.0-only',
  'GPL-3.0-only',
  'OFL-1.1',
  'Apache-2.0',
]);
const USES: Use[] = [
  'in-game',
  'placeholder',
  'derive-layout',
  'style-reference',
  'vision-input',
  'edit-audio',
  'derive-audio',
];

function requiresAttribution(license: string): boolean {
  return license.startsWith('CC-BY-') || license === 'OGA-BY-3.0';
}

function isGpl(license: string): boolean {
  return license.startsWith('GPL-');
}

function safePath(path: string): boolean {
  return Boolean(path) && !isAbsolute(path) && !path.includes('\\') && !path.split('/').includes('..');
}

function validateEntry(path: string, value: unknown): LicenseMapEntry {
  if (!safePath(path)) throw new Error(`unsafe license-map path ${JSON.stringify(path)}`);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`invalid license-map entry for ${path}`);
  const entry = value as Partial<LicenseMapEntry>;
  if (typeof entry.license !== 'string' || (!LICENSES.has(entry.license) && entry.license !== 'NOASSERTION')) {
    throw new Error(`unsupported tier-2 license for ${path}: ${JSON.stringify(entry.license)}`);
  }
  if (entry.attribution !== null && typeof entry.attribution !== 'string') {
    throw new Error(`invalid attribution for ${path}`);
  }
  if (
    !entry.dropped &&
    requiresAttribution(entry.license ?? '') &&
    (entry.attribution === null || entry.attribution.trim() === '')
  ) {
    throw new Error(`tier-2 license ${entry.license} requires attribution for ${path}`);
  }
  if (entry.dropped !== undefined && (typeof entry.dropped !== 'string' || entry.dropped.trim() === '')) {
    throw new Error(`invalid dropped reason for ${path}`);
  }
  if (!entry.dropped && isGpl(entry.license ?? '')) {
    throw new Error(`tier-2 GPL license ${entry.license} must be dropped for ${path}`);
  }
  if (!entry.dropped && entry.license === 'NOASSERTION') throw new Error(`kept item ${path} needs a mapped license`);
  return entry as LicenseMapEntry;
}

export function validateLicenseMap(value: unknown): LicenseMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('license map must be a JSON object');
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([path, entry]) => [path, validateEntry(path, entry)]),
  );
}

export async function readLicenseMap(path: string): Promise<LicenseMap> {
  return validateLicenseMap(JSON.parse(await readFile(path, 'utf8')));
}

function contained(root: string, local: string): string {
  const path = resolve(root, ...local.split('/'));
  const fromRoot = relative(root, path);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`license-map path escapes extracted tree: ${local}`);
  }
  return path;
}

export async function filterLicensedItems(
  extracted: string,
  items: Item[],
  map: LicenseMap,
  sourcePaths: string[] = [],
): Promise<string[]> {
  const dropped: string[] = [];
  for (const [path, entry] of Object.entries(map)) {
    if (!entry.dropped) continue;
    await rm(contained(extracted, path), { force: true });
    dropped.push(`${path}: ${entry.dropped}`);
  }
  // Scene sources do not carry per-file rights; a mixed-license map cannot safely publish them.
  for (const path of sourcePaths) {
    await rm(contained(extracted, path), { force: true });
    dropped.push(`${path}: scene source needs per-file rights`);
  }
  for (const path of items.map((item) => item.path)) {
    const entry = map[path];
    if (entry && !entry.dropped) continue;
    await rm(contained(extracted, path), { force: true });
    if (!entry) dropped.push(`${path}: missing machine-readable license`);
  }
  return dropped.sort();
}

function basis(
  license: string,
  attribution: string | null,
  confirmedBy: string,
  date: string,
  ref: string,
): RightsBasis {
  if (!LICENSES.has(license) || isGpl(license)) {
    throw new Error(`unsupported kept tier-2 license ${JSON.stringify(license)}`);
  }
  return {
    type: 'license',
    license,
    ref,
    uses: [...USES],
    audience: 'public',
    redistribution: 'free',
    attribution,
    set_by: { role: 'intake-code' },
    confirmed_by: confirmedBy,
    date,
    note: 'Operator confirmed the mirror license metadata.',
  };
}

function rights(licenseBasis: RightsBasis): NonNullable<AssetCard['rights']> {
  return {
    uses: [...licenseBasis.uses],
    audience: licenseBasis.audience,
    redistribution: licenseBasis.redistribution,
    attribution: licenseBasis.attribution ?? null,
    processing: 'any',
    basis: [licenseBasis],
  };
}

function assertValid(card: AssetCard): void {
  const validation = validateCard(card);
  if (!validation.ok) throw new Error(`tier-2 card ${card.id} is invalid: ${validation.errors.join('; ')}`);
}

export function applyTier2Rights(
  cards: CardSet,
  options: {
    license: string;
    licenseRef: string;
    licenseMap?: LicenseMap;
    attribution?: string | null;
    confirmedBy: string;
    date: string;
  },
): void {
  if (!options.confirmedBy.trim()) throw new Error('--confirmed-by must name the human who confirmed the license');
  const collectionBasis = basis(
    options.license,
    options.attribution ?? null,
    options.confirmedBy,
    options.date,
    options.licenseRef,
  );
  cards.collection.license = options.license;
  cards.collection.rights = rights(collectionBasis);
  cards.collection.status = cards.assets.some((asset) => asset.status === 'measured') ? 'measured' : 'draft';
  assertValid(cards.collection);
  for (const card of cards.assets) {
    const source = card.source?.files.find((file) => file.role === 'primary')?.path ?? card.source?.files[0]?.path;
    const entry = source ? options.licenseMap?.[source] : undefined;
    if (options.licenseMap && !entry)
      throw new Error(`card ${card.id} has no license-map entry for ${source ?? 'source'}`);
    if (entry) {
      const itemBasis = basis(entry.license, entry.attribution, options.confirmedBy, options.date, options.licenseRef);
      card.license = entry.license;
      card.rights = rights(itemBasis);
    }
    assertValid(card);
  }
}
