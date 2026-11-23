import type { EditorLibrary, EditorLibraryItem } from '@ogm/contracts/browser';

/** What the creator narrowed the library to: a kind chip, then at most one finer chip per step, plus search words. */
export type LibraryFilter = {
  group?: string;
  tag?: string;
  pack?: string;
  size?: EditorLibraryItem['size'];
  query: string;
};

/** A finer chip: a family word (`Tree`), a pack (`Zombie Rural`) or a size, with how many pieces it keeps. */
export type FinerChip = { step: 'tag' | 'pack' | 'size'; value: string; label: string; count: number };

/** Family words shown before packs; the rest stay reachable through search. */
const MAX_TAGS = 12;
const SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' } as const;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Every search word must start a word of the piece's label, family, pack or kind. */
export function matchesQuery(item: EditorLibraryItem, query: string, packLabel = '', groupLabel = ''): boolean {
  const wanted = words(query);
  if (wanted.length === 0) return true;
  const have = words(`${item.label} ${item.tag} ${packLabel} ${groupLabel}`);
  return wanted.every((word) => have.some((candidate) => candidate.startsWith(word)));
}

export function filterLibrary(library: EditorLibrary, filter: LibraryFilter): EditorLibraryItem[] {
  const packs = new Map(library.packs.map((pack) => [pack.id, pack.label]));
  const groups = new Map(library.groups.map((group) => [group.id, group.label]));
  return library.items.filter(
    (item) =>
      (filter.group === undefined || item.group === filter.group) &&
      (filter.tag === undefined || item.tag === filter.tag) &&
      (filter.pack === undefined || item.pack === filter.pack) &&
      (filter.size === undefined || item.size === filter.size) &&
      matchesQuery(item, filter.query, packs.get(item.pack), groups.get(item.group)),
  );
}

/**
 * The finer chips for the open kind: its most common family words, then its packs, then sizes when the catalog
 * measured them. A step with a single choice narrows nothing, so it shows no chips (unless that chip is on).
 */
export function finerChips(library: EditorLibrary, filter: LibraryFilter): FinerChip[] {
  const inGroup = filterLibrary(library, { group: filter.group, query: '' });
  const count = (key: (item: EditorLibraryItem) => string | undefined) => {
    const counts = new Map<string, number>();
    for (const item of inGroup) {
      const value = key(item);
      if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const keep = (entries: [string, number][], on: string | undefined) => (entries.length > 1 || on ? entries : []);
  const packLabels = new Map(library.packs.map((pack) => [pack.id, pack.label]));
  const tags = keep(
    count((item) => item.tag),
    filter.tag,
  );
  const topTags = tags.slice(0, MAX_TAGS);
  if (filter.tag && !topTags.some(([value]) => value === filter.tag)) topTags.push([filter.tag, 0]);
  return [
    ...topTags.map(([value, n]) => ({ step: 'tag' as const, value, label: value, count: n })),
    ...keep(
      count((item) => item.pack),
      filter.pack,
    ).map(([value, n]) => ({
      step: 'pack' as const,
      value,
      label: packLabels.get(value) ?? value,
      count: n,
    })),
    ...keep(
      count((item) => item.size),
      filter.size,
    ).map(([value, n]) => ({
      step: 'size' as const,
      value,
      label: SIZE_LABELS[value as keyof typeof SIZE_LABELS] ?? value,
      count: n,
    })),
  ];
}

/** Tapping a finer chip turns it on, or off when it already is; other steps keep their choice. */
export function toggleChip(filter: LibraryFilter, chip: Pick<FinerChip, 'step' | 'value'>): LibraryFilter {
  const on = filter[chip.step] === chip.value;
  return { ...filter, [chip.step]: on ? undefined : chip.value };
}

/** Choosing another kind clears the finer chips, which belonged to the old kind. */
export function chooseGroup(filter: LibraryFilter, group: string): LibraryFilter {
  return { query: filter.query, group: filter.group === group ? undefined : group };
}
