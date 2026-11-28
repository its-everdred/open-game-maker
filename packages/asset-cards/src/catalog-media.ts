import type { ResolvedCard } from './types.js';

/** Named media slots; URLs are issued by the catalogue API and never expose disk paths. */
export type CatalogMediaRole = 'thumb' | 'sheet' | 'waveform' | 'clip' | 'specimen' | 'diorama' | 'loop' | 'source';
export type CatalogMedia = Partial<Record<CatalogMediaRole, string>>;

const PREVIEW_ROLES = ['thumb', 'sheet', 'waveform', 'clip', 'specimen', 'diorama', 'loop'] as const;

/** Construct API references only for media named by a card; absence means no preview is available. */
export function catalogMedia(card: ResolvedCard, prefix = '/api/catalog'): CatalogMedia {
  return catalogMediaRefs(
    card.id,
    card.previews ?? {},
    card.resolved.rights.uses.includes('in-game') && !!card.source?.files.some((file) => file.role === 'primary'),
    prefix,
  );
}

export function catalogMediaRefs(
  id: string,
  previews: Partial<Record<Exclude<CatalogMediaRole, 'source'>, string>>,
  hasSource: boolean,
  prefix = '/api/catalog',
): CatalogMedia {
  const result: CatalogMedia = {};
  const url = (role: CatalogMediaRole) => `${prefix}/assets/${encodeURIComponent(id)}/media/${role}`;
  for (const role of PREVIEW_ROLES) if (previews[role]) result[role] = url(role);
  if (hasSource) result.source = url('source');
  return result;
}
