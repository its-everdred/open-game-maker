import type { AssetCard } from '@ogm/contracts';

import { inFamily, packOf, setFor } from './families.js';
import type { CardIndex, ResolvedCard, SearchQuery } from './types.js';

type Status = AssetCard['status'];

const STATUS_RANK: Record<Status, number> = {
  reviewed: 4,
  tagged: 3,
  measured: 2,
  draft: 1,
  quarantined: 0,
  rejected: 0,
};
const TAGGED: Status[] = ['tagged', 'reviewed'];
const MEASURED: Status[] = ['measured', 'tagged', 'reviewed'];
const BIDI_CONTROLS = new Set([
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);
// E05-3: models and sprites have no tagging pass yet, so their drafts are searchable by default.
const UNTAGGED_OK: Status[] = ['draft', 'measured', 'tagged', 'reviewed'];

/** C3 §10 status defaults per kind; `--include-draft` adds `draft` everywhere. Quarantined and rejected never pass. */
export function statusAllowed(kind: string | undefined, status: Status, includeDraft = false): boolean {
  if (includeDraft && status === 'draft') return true;
  if (kind === 'model' || kind === 'sprite') return UNTAGGED_OK.includes(status);
  if (kind === 'audio' || kind === 'inspiration') return TAGGED.includes(status);
  return MEASURED.includes(status);
}

/** Top-level kinds a card covers: its own, or for a collection the kinds it counts. */
export function kindsOf(card: AssetCard): string[] {
  if (card.card_type === 'asset') return card.kind ? [card.kind] : [];
  const counts = card.collection_info?.counts ?? {};
  return [...new Set(Object.keys(counts).map((key) => key.split('/')[0]))];
}

function tierOf(id: string): number | undefined {
  const match = /^t(\d):/.exec(id);
  return match ? Number(match[1]) : undefined;
}

function normalize(word: string): string {
  const lowered = word.toLowerCase();
  return lowered.length > 3 && lowered.endsWith('s') ? lowered.slice(0, -1) : lowered;
}

function tokens(text: string | undefined): string[] {
  return (text ?? '')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(normalize);
}

/**
 * Weighted fields: title 3, objects 2, moods 2, everything else 1.
 *
 * Moods are their own field rather than one more line of prose: a card tagged `epic` outranks a card whose description
 * only happens to contain the word, which is what "rank by mood" has to mean for the audio direction query.
 */
function fieldsOf(card: ResolvedCard): [number, string[]][] {
  const describe = card.describe ?? {};
  const rest = [
    describe.description,
    ...(describe.keywords ?? []),
    ...(describe.roles ?? []),
    ...(describe.genre ?? []),
    ...(describe.instruments ?? []),
    describe.world,
    ...(card.resolved.environments ?? []),
    ...(card.resolved.settings ?? []),
    card.kind,
    card.subkind,
    card.id,
    ...(card.source?.files ?? []).map((file) => file.path),
    ...(card.sprite?.animations ?? []).map((animation) => animation.name),
    ...(card.rig?.clips ?? []).flatMap((clip) => [clip.name, clip.canonical]),
    ...(card.anim?.clips ?? []).flatMap((clip) => [clip.name, clip.canonical]),
  ];
  return [
    [3, tokens(card.title)],
    [2, (describe.objects ?? []).flatMap(tokens)],
    [2, (describe.moods ?? []).flatMap(tokens)],
    [1, rest.flatMap((value) => tokens(value))],
  ];
}

/**
 * 0 when any word is missing (AND match), else the sum of weighted hits. Query words split like titles do,
 * so `Rig_Medium` needs both `rig` and `medium`.
 */
export function score(card: ResolvedCard, words: string[]): number {
  const fields = fieldsOf(card);
  const queryTokens = words.flatMap(tokens);
  if (queryTokens.length === 0) return 0;
  let total = 0;
  for (const word of queryTokens) {
    const hits = fields.reduce(
      (sum, [weight, list]) => sum + weight * list.filter((token) => token === word).length,
      0,
    );
    if (hits === 0) return 0;
    total += hits;
  }
  return total;
}

/** The rig a card's skeleton is, plus the rig whose clips it can play (`retarget_rig_id`). */
function rigIdsOf(card: ResolvedCard): string[] {
  return [card.rig?.rig_id, card.rig?.retarget_rig_id].filter((id): id is string => Boolean(id));
}

function collectionOf(index: CardIndex, card: ResolvedCard): ResolvedCard | undefined {
  return card.card_type === 'asset' && card.collection ? index.collections[card.collection] : undefined;
}

/** Every filter except text: rights, status, kind and the explicit flags. */
export function passes(index: CardIndex, card: ResolvedCard, q: SearchQuery): boolean {
  const use = q.use ?? 'in-game';
  if (card.status === 'quarantined' || card.status === 'rejected') return false;
  if (collectionOf(index, card)?.status === 'quarantined') return false;
  if (q.excludeAiGenerated && card.generation?.method === 'ai') return false;
  if (!card.resolved.rights.uses.includes(use)) return false;
  if ((use === 'in-game' || use === 'placeholder') && kindsOf(card).includes('inspiration')) return false;

  const kinds = kindsOf(card);
  const candidates = q.kind ? kinds.filter((kind) => kind === q.kind) : kinds.length > 0 ? kinds : [undefined];
  if (candidates.length === 0) return false;
  if (!candidates.some((kind) => statusAllowed(kind, card.status, q.includeDraft))) return false;
  if (q.subkind && card.card_type === 'asset' && card.subkind !== q.subkind) return false;

  if (q.family && card.resolved.style_family !== q.family) return false;
  if (q.moods?.length) {
    // The generated card type gives these fields as fixed-length tuple unions, so compare as plain string lists.
    const moods: readonly string[] = card.describe?.moods ?? [];
    if (!q.moods.every((mood) => moods.includes(mood))) return false;
  }
  if (q.genres?.length) {
    const genres: readonly string[] = card.describe?.genre ?? [];
    if (!q.genres.some((genre) => genres.includes(genre))) return false;
  }
  const needsSet = q.set !== undefined || Boolean(q.gameSets?.length);
  const pack = needsSet ? packOf(card.id) : undefined;
  const set = pack ? setFor(pack)?.id : undefined;
  if (q.set !== undefined) {
    if (set !== q.set) return false;
  }
  if (q.gameFamily && !inFamily(card, q.gameFamily)) return false;
  if (q.gameSets?.length && card.resolved.style_family !== 'any') {
    if ((!set || !q.gameSets.includes(set)) && (!pack || !q.gamePacks?.includes(pack))) return false;
  }
  if (q.pov && !(card.resolved.pov_fit ?? []).includes(q.pov)) return false;
  if (q.directions !== undefined && (card.sprite?.directions?.length ?? 0) !== q.directions) return false;
  if (q.tier !== undefined && tierOf(card.id) !== q.tier) return false;
  if (q.collection && card.id !== q.collection && card.collection !== q.collection) return false;
  if (q.rigId && !rigIdsOf(card).includes(q.rigId)) return false;
  if (q.sameRigAs) {
    const reference = index.cards.find((other) => other.id === q.sameRigAs);
    const wanted = reference ? rigIdsOf(reference) : [];
    if (!rigIdsOf(card).some((id) => wanted.includes(id))) return false;
  }
  return true;
}

/** Whether every query word is in the card's name (title, objects, roles or id), not only its files or clips. */
function names(card: ResolvedCard, words: string[]): boolean {
  const describe = card.describe ?? {};
  const name = new Set(
    [card.title, card.id, ...(describe.objects ?? []), ...(describe.roles ?? [])].flatMap((value) => tokens(value)),
  );
  const queryTokens = words.flatMap(tokens);
  return queryTokens.length > 0 && queryTokens.every((token) => name.has(token));
}

/**
 * Characters the query names outrank props and tiles that share the word: animated model characters (their own
 * clips, or a rig a clip library targets) first, then other characters and creatures. A match on animation or
 * file names alone ("walk") earns no tier, and clip libraries get none: `Ranged_Bow_Draw` would outrank bows.
 */
function characterTier(card: ResolvedCard, words: string[], animatedRigs: Set<string>): number {
  if (card.card_type !== 'asset' || (card.subkind !== 'character' && card.subkind !== 'creature')) return 0;
  if (!names(card, words)) return 0;
  const animated = (card.rig?.clips ?? []).length > 0 || rigIdsOf(card).some((id) => animatedRigs.has(id));
  return card.kind === 'model' && animated ? 2 : 1;
}

export function search(index: CardIndex, q: SearchQuery): ResolvedCard[] {
  const words = q.words ?? [];
  const animatedRigs = new Set(
    index.cards.flatMap((card) => (card.card_type === 'asset' && card.anim ? [card.anim.target_rig_id] : [])),
  );
  const scored = index.cards
    .filter((card) => passes(index, card, q))
    .map((card) => ({ card, score: words.length > 0 ? score(card, words) : 0 }))
    .filter(({ score: value }) => words.length === 0 || value > 0)
    .map((row) => ({ ...row, tier: words.length > 0 ? characterTier(row.card, words, animatedRigs) : 0 }));
  scored.sort(
    (a, b) =>
      b.tier - a.tier ||
      b.score - a.score ||
      Number(a.card.card_type === 'collection') - Number(b.card.card_type === 'collection') ||
      STATUS_RANK[b.card.status] - STATUS_RANK[a.card.status] ||
      a.card.id.localeCompare(b.card.id),
  );
  const hits = scored.map(({ card }) => card);
  return q.limit === undefined ? hits : hits.slice(0, q.limit);
}

export function info(index: CardIndex, ids: string[]): (ResolvedCard | { id: string; missing: true })[] {
  const byId = new Map(index.cards.map((card) => [card.id, card]));
  return ids.map((id) => byId.get(id) ?? { id, missing: true });
}

/** One search row: `id  kind/subkind  status  family  title`. */
export function formatRow(card: ResolvedCard): string {
  const kind =
    card.card_type === 'asset'
      ? `${card.kind ?? '-'}/${card.subkind ?? '-'}`
      : `collection/${kindsOf(card).join('+') || '-'}`;
  const safe = (value: string): string =>
    [...value]
      .map((character) => {
        const code = character.codePointAt(0)!;
        return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || BIDI_CONTROLS.has(code) ? '?' : character;
      })
      .join('');
  const generation = card.generation?.method === 'ai' ? `  [AI-generated: ${safe(card.generation.tool)}]` : '';
  return `${[card.id, kind, card.status, card.resolved.style_family ?? '-', card.title].map(safe).join('  ')}${generation}`;
}
