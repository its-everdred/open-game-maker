import type { AssetsLock, LockEntry, Use } from '@ogm/contracts';
import type { ResolvedCard } from '@ogm/asset-cards';

export type RefusalRule =
  | 'ai-generated-disabled'
  | 'needs-in-game'
  | 'placeholder-only'
  | 'no-redistribution'
  | 'quarantined'
  | 'rejected'
  | 'family-mismatch'
  | 'private-in-public'
  | 'stale-rights'
  | 'missing-license-metadata'
  | 'missing-file'
  | 'sha-mismatch'
  | 'name-collision'
  | 'unknown-id'
  | 'unlisted';

export type Refusal = { code: 'rights'; rule: RefusalRule; id: string; detail: string; path?: string };
export type LockRights = LockEntry['rights'];

const ALL_USES: Use[] = [
  'in-game',
  'placeholder',
  'derive-layout',
  'style-reference',
  'vision-input',
  'edit-audio',
  'derive-audio',
];
const AUDIENCE = ['private', 'public'] as const;
const REDISTRIBUTION = ['none', 'in-build', 'free'] as const;

function refusal(id: string, rule: RefusalRule, detail: string): Refusal {
  return { code: 'rights', rule, id, detail };
}

export function rightsForCard(card: ResolvedCard, collections: Record<string, ResolvedCard>): LockRights {
  const declared = card.rights ?? (card.collection === undefined ? undefined : collections[card.collection]?.rights);
  return {
    uses: [...card.resolved.rights.uses],
    audience: card.resolved.rights.audience,
    redistribution: card.resolved.rights.redistribution,
    attribution: declared?.attribution ?? null,
  };
}

function sameRights(left: LockRights, right: LockRights): boolean {
  return (
    [...left.uses].sort().join('\0') === [...right.uses].sort().join('\0') &&
    left.audience === right.audience &&
    left.redistribution === right.redistribution &&
    left.attribution === right.attribution
  );
}

export function refusalsForUse(
  card: ResolvedCard,
  lock: AssetsLock | null,
  options: { placeholder: boolean; exception?: string; visibility?: 'public' | 'private' },
): Refusal[] {
  const result: Refusal[] = [];
  const rights = card.resolved.rights;
  if (rights.redistribution === 'none') {
    result.push(refusal(card.id, 'no-redistribution', 'effective rights prohibit redistribution'));
  }
  if (card.status === 'quarantined') result.push(refusal(card.id, 'quarantined', 'card status is quarantined'));
  if (card.status === 'rejected') result.push(refusal(card.id, 'rejected', 'card status is rejected'));
  if (options.visibility === 'public' && rights.audience === 'private') {
    result.push(refusal(card.id, 'private-in-public', 'private-audience asset cannot enter a public repository'));
  }
  if (!rights.uses.includes('in-game') && !(options.placeholder && rights.uses.includes('placeholder'))) {
    result.push(refusal(card.id, 'needs-in-game', 'effective rights do not allow this in-game use'));
  }
  const family = card.resolved.style_family;
  if (lock !== null && family !== 'any' && family !== lock.family && options.exception === undefined) {
    result.push(
      refusal(card.id, 'family-mismatch', `style family ${family ?? 'missing'} does not match ${lock.family}`),
    );
  }
  return result;
}

export function refusalsForCheck(
  entry: LockEntry,
  card: ResolvedCard | undefined,
  file: { exists: boolean; sha256?: string },
  options: {
    publish: boolean;
    visibility: 'public' | 'private';
    currentRights?: LockRights;
  },
): Refusal[] {
  const result: Refusal[] = [];
  if (entry.credit === undefined) {
    result.push(refusal(entry.id, 'missing-license-metadata', 'lock entry has no credit metadata'));
  }
  if (!file.exists) result.push(refusal(entry.id, 'missing-file', `${entry.path} does not exist`));
  else if (file.sha256 !== entry.sha256) {
    result.push(refusal(entry.id, 'sha-mismatch', `${entry.path} sha256 does not match the lock`));
  }

  if (card === undefined && !entry.id.startsWith('t3:')) {
    result.push(refusal(entry.id, 'unknown-id', 'asset is not present in the current index'));
  }
  if (card?.status === 'quarantined') result.push(refusal(entry.id, 'quarantined', 'card status is quarantined'));
  if (card?.status === 'rejected') result.push(refusal(entry.id, 'rejected', 'card status is rejected'));
  if (
    card !== undefined &&
    (entry.license !== card.resolved.license ||
      !sameRights(
        entry.rights,
        options.currentRights ?? {
          ...card.resolved.rights,
          uses: [...card.resolved.rights.uses],
          attribution: card.rights?.attribution ?? null,
        },
      ))
  ) {
    result.push(refusal(entry.id, 'stale-rights', 'lock license or rights differ from the current index; refresh it'));
  }

  const hasInGame = entry.rights.uses.includes('in-game');
  const hasPlaceholder = entry.rights.uses.includes('placeholder');
  if (!hasInGame && !(hasPlaceholder && !options.publish)) {
    result.push(
      refusal(
        entry.id,
        options.publish && hasPlaceholder ? 'placeholder-only' : 'needs-in-game',
        options.publish
          ? 'placeholder-only assets cannot be published'
          : 'rights allow neither in-game nor placeholder use',
      ),
    );
  }
  if (entry.rights.redistribution === 'none') {
    result.push(refusal(entry.id, 'no-redistribution', 'lock rights prohibit redistribution'));
  }
  if (options.publish && options.visibility === 'public' && entry.rights.audience === 'private') {
    result.push(refusal(entry.id, 'private-in-public', 'private-audience asset cannot enter a public repository'));
  }
  return result;
}

function minimum<T extends string>(order: readonly T[], values: T[]): T {
  return values.reduce((lowest, value) => (order.indexOf(value) < order.indexOf(lowest) ? value : lowest));
}

export function intersectLockRights(rights: LockRights[]): LockRights {
  if (rights.length === 0) {
    return { uses: [...ALL_USES], audience: 'public', redistribution: 'free', attribution: null };
  }
  const uses = rights[0]!.uses.filter((use) => rights.slice(1).every((candidate) => candidate.uses.includes(use)));
  const attributions = [...new Set(rights.map((candidate) => candidate.attribution).filter((value) => value !== null))];
  return {
    uses,
    audience: minimum(
      AUDIENCE,
      rights.map((candidate) => candidate.audience),
    ),
    redistribution: minimum(
      REDISTRIBUTION,
      rights.map((candidate) => candidate.redistribution),
    ),
    attribution: attributions.length === 0 ? null : attributions.join('; '),
  };
}
