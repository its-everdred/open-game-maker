import { useQuery } from '@tanstack/react-query';
import type { StyleShowcase } from '@ogm/contracts';

export type CatalogPack = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  aiGenerated: boolean;
  compatibleWith?: string[];
};

export type CatalogSet = {
  id: string;
  label: string;
  pickerFamilies: string[];
  vendors: string[];
  traits: Record<string, string | undefined>;
  packs: CatalogPack[];
  showcase?: CatalogShowcase;
};

export type CatalogShowcase = StyleShowcase;

export type CatalogFamily = {
  id: string;
  label: string;
  views: string[];
  creationChoice: boolean;
  packs: CatalogPack[];
  sets: CatalogSet[];
};

export type StyleChoice = {
  id: string;
  label: string;
  familyId: string;
  views: string[];
  packs: CatalogPack[];
  showcase?: CatalogShowcase;
};

export type PickerFamily = Pick<CatalogFamily, 'id' | 'label'>;

/** One audio style tile the Sound step offers: a direction and the 60 s montage that plays for it (#357). */
export type AudioStyleTile = {
  id: string;
  label: string;
  style: string;
  mood: string;
  sampleUrl: string;
};

export type AudioStyleFamily = { id: string; label: string; styles: AudioStyleTile[] };

export function useAudioStyles() {
  return useQuery({
    queryKey: ['catalog', 'audio-styles'],
    queryFn: fetchAudioStyles,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

async function fetchAudioStyles(): Promise<AudioStyleFamily[]> {
  const response = await fetch('/api/catalog/audio-styles', { credentials: 'include' });
  if (!response.ok) throw new Error(`audio styles ${response.status}`);
  return ((await response.json()) as { families: AudioStyleFamily[] }).families;
}

export function useCatalog() {
  return useQuery({
    queryKey: ['catalog', 'style-families'],
    queryFn: fetchStyleFamilies,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function styleChoices(families: CatalogFamily[], allowAiGenerated = true): StyleChoice[] {
  return families.flatMap((family) => {
    if (!family.creationChoice) return [];
    if (family.sets.length === 0) {
      const choice = allowedChoice(choiceForFamily(family), allowAiGenerated);
      return choice ? [choice] : [];
    }
    return family.sets.flatMap((set) => {
      const choice = allowedChoice(choiceFor(family, set), allowAiGenerated);
      return choice ? [choice] : [];
    });
  });
}

export function pickerFamilies(families: CatalogFamily[], allowAiGenerated = true): PickerFamily[] {
  return families
    .filter((family) => family.creationChoice && setsForFamily(families, family.id, allowAiGenerated).length > 0)
    .map((family) => ({
      id: family.id,
      label: family.id === 'isometric-2d' ? 'Isometric' : family.label,
    }));
}

export function setsForFamily(families: CatalogFamily[], familyId: string, allowAiGenerated = true): StyleChoice[] {
  const family = families.find((candidate) => candidate.id === familyId && candidate.creationChoice);
  if (!family) return [];
  const direct = family.sets.length > 0 ? family.sets.map((set) => choiceFor(family, set)) : [choiceForFamily(family)];
  const aliased = families.flatMap((owner) =>
    owner.sets.filter((set) => set.pickerFamilies.includes(familyId)).map((set) => choiceFor(owner, set)),
  );
  return [...new Map([...direct, ...aliased].map((choice) => [choice.id, choice])).values()].flatMap((choice) => {
    const allowed = allowedChoice(choice, allowAiGenerated);
    return allowed ? [allowed] : [];
  });
}

function allowedChoice(choice: StyleChoice, allowAiGenerated: boolean): StyleChoice | undefined {
  if (allowAiGenerated) return choice;
  const packs = choice.packs.filter((pack) => !pack.aiGenerated);
  if (choice.packs.length > 0 && packs.length === 0) return undefined;
  return { ...choice, packs };
}

function choiceForFamily(family: CatalogFamily): StyleChoice {
  return {
    id: family.id,
    label: family.label,
    familyId: family.id,
    views: family.views,
    packs: family.packs,
  };
}

function choiceFor(family: CatalogFamily, set: CatalogSet): StyleChoice {
  // A mixed showcase cannot identify which pixels came from which pack.
  // Use individual pack previews so generated content can be labeled or hidden.
  const mixedProvenance = set.packs.some((pack) => pack.aiGenerated) && set.packs.some((pack) => !pack.aiGenerated);
  return {
    id: set.id,
    label: set.label,
    familyId: family.id,
    views: family.views,
    packs: set.packs,
    ...(set.showcase && !mixedProvenance ? { showcase: set.showcase } : {}),
  };
}

async function fetchStyleFamilies(): Promise<CatalogFamily[]> {
  const response = await fetch('/api/catalog/style-families', { credentials: 'include' });
  if (!response.ok) throw new Error(`catalog ${response.status}`);
  return (await response.json()) as CatalogFamily[];
}
