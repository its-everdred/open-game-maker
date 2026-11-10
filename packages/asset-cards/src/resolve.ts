import { effectiveRights, type AssetCard, type EffectiveRights } from '@ogm/contracts';

import type { ResolvedCard, Rights } from './types.js';

const AUDIENCE = ['private', 'public'] as const;
const REDISTRIBUTION = ['none', 'in-build', 'free'] as const;
const NO_RIGHTS: Rights = { uses: [], audience: 'private', redistribution: 'none' };

function lower<T extends string>(order: readonly T[], left: T, right: T): T {
  return order.indexOf(left) <= order.indexOf(right) ? left : right;
}

function toRights(effective: EffectiveRights): Rights {
  return { uses: [...effective.uses].sort(), audience: effective.audience, redistribution: effective.redistribution };
}

/** C3 §5: an asset's rights are its own basis intersected with its collection's, so they never widen. */
export function intersectRights(collection: Rights, asset: Rights): Rights {
  return {
    uses: asset.uses.filter((use) => collection.uses.includes(use)),
    audience: lower(AUDIENCE, collection.audience, asset.audience),
    redistribution: lower(REDISTRIBUTION, collection.redistribution, asset.redistribution),
  };
}

function ownRights(card: AssetCard): Rights | null {
  return card.rights ? toRights(effectiveRights(card.rights.basis)) : null;
}

/** C3 §8: fill inheritable fields from the collection card, marking provenance `by: collection`. Throws RightsError. */
export function resolve(card: AssetCard, collections: Record<string, AssetCard>): ResolvedCard {
  const parent = card.card_type === 'asset' && card.collection ? collections[card.collection] : undefined;
  const provenance: Record<string, { by: 'collection' }> = {};
  const own = ownRights(card);
  const inherited = parent ? ownRights(parent) : null;

  let rights: Rights;
  if (own && inherited) rights = intersectRights(inherited, own);
  else if (own) rights = own;
  else if (inherited) {
    rights = inherited;
    provenance.rights = { by: 'collection' };
  } else rights = NO_RIGHTS;

  let license = card.license;
  if (license === undefined && parent?.license !== undefined) {
    license = parent.license;
    provenance.license = { by: 'collection' };
  }

  let generation = card.generation;
  if (generation === undefined && parent?.generation !== undefined) {
    generation = parent.generation;
    provenance.generation = { by: 'collection' };
  }

  const describe = card.describe ?? {};
  const parentDescribe = parent?.describe ?? {};
  const pick = <K extends 'style_family' | 'set' | 'pov_fit' | 'settings' | 'environments'>(key: K) => {
    if (describe[key] !== undefined) return describe[key];
    if (parentDescribe[key] === undefined) return undefined;
    provenance[`describe.${key}`] = { by: 'collection' };
    return parentDescribe[key];
  };

  const resolved: ResolvedCard['resolved'] = { license: license ?? 'NOASSERTION', rights, provenance };
  const styleFamily = pick('style_family');
  const set = pick('set');
  const povFit = pick('pov_fit');
  const settings = pick('settings');
  const environments = pick('environments');
  if (styleFamily !== undefined) resolved.style_family = styleFamily;
  if (set !== undefined) resolved.set = set;
  if (povFit !== undefined) resolved.pov_fit = povFit;
  if (settings !== undefined) resolved.settings = settings;
  if (environments !== undefined) resolved.environments = environments;
  return { ...card, ...(generation === undefined ? {} : { generation }), resolved };
}
