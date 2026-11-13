import {
  AUDIO_STYLES,
  audioStyle,
  hasAudioDirection,
  type AudioDirection,
  type ScopeChoices,
} from '@ogm/contracts/browser';

export const STEP_ORDER = ['genre', 'vibe', 'family', 'sound', 'world', 'players', 'view', 'talk'] as const;
export type StepKey = (typeof STEP_ORDER)[number];
export type ChoiceKey = Exclude<StepKey, 'talk'>;
export type Option = { id: string; label: string };
export type StepDefinition = {
  key: ChoiceKey;
  title: string;
  ask: string;
  hint?: string;
  max: number;
  options: Option[];
};
export type StepChoice = { picks: string[]; other?: string };
export type NewGameChoices = Partial<Record<ChoiceKey, StepChoice>>;

const option = (id: string, label: string): Option => ({ id, label });

export const STATIC_STEPS = {
  genre: {
    key: 'genre',
    title: 'Genre',
    ask: 'What kind of game is it?',
    hint: 'Pick up to 3',
    max: 3,
    options: [
      option('shooter', 'Shooter'),
      option('adventure', 'Adventure'),
      option('rpg', 'RPG'),
      option('sports', 'Sports'),
      option('racing', 'Racing'),
      option('strategy', 'Strategy'),
      option('puzzle', 'Puzzle'),
      option('battle', 'Battle'),
      option('platformer', 'Platformer'),
      option('sim', 'Sim'),
      option('roguelike', 'Roguelike'),
      option('craft', 'Craft'),
      option('tcg', 'TCG'),
      option('rhythm', 'Rhythm'),
    ],
  },
  vibe: {
    key: 'vibe',
    title: 'Vibe',
    ask: 'How should it feel?',
    hint: 'Pick up to 3',
    max: 3,
    options: [
      option('retro', 'Retro'),
      option('future', 'Future'),
      option('cool', 'Cool'),
      option('cute', 'Cute'),
      option('old', 'Old'),
      option('creepy', 'Creepy'),
      option('cozy', 'Cozy'),
      option('epic', 'Epic'),
      option('surreal', 'Surreal'),
      option('funny', 'Funny'),
      option('calm', 'Calm'),
    ],
  },
  world: {
    key: 'world',
    title: 'World',
    ask: 'Where does it take place?',
    hint: 'Pick up to 3',
    max: 3,
    options: [
      option('dungeon', 'Dungeon'),
      option('forest', 'Forest'),
      option('space', 'Space'),
      option('city', 'City'),
      option('ocean', 'Ocean'),
      option('desert', 'Desert'),
      option('sky', 'Sky islands'),
      option('snow', 'Snow'),
      option('castle', 'Castle'),
      option('farm', 'Farm'),
      option('haunted', 'Haunted'),
    ],
  },
  players: {
    key: 'players',
    title: 'Players',
    ask: 'Who plays?',
    hint: 'Pick one',
    max: 1,
    options: [option('single', 'Solo'), option('multi', 'Multiplayer')],
  },
} satisfies Record<'genre' | 'vibe' | 'world' | 'players', StepDefinition>;

const GENRE_VIEWS: Partial<Record<string, string[]>> = {
  platformer: ['side', 'follow'],
  shooter: ['fps', 'topdown', 'side'],
  racing: ['follow', 'topdown'],
  strategy: ['iso', 'topdown', 'fixed'],
};

export function viewsFor(familyViews: string[], genres: string[]): string[] {
  const defaults = new Set(genres.flatMap((genre) => GENRE_VIEWS[genre] ?? []));
  if (defaults.size === 0) return familyViews;
  const filtered = familyViews.filter((view) => defaults.has(view));
  return filtered.length > 0 ? filtered : familyViews;
}

function labelsFor(key: 'genre' | 'vibe' | 'world', picks: string[]): string[] {
  const labels = new Map(STATIC_STEPS[key].options.map(({ id, label }) => [id, label]));
  return picks.map((pick) => labels.get(pick) ?? pick);
}

export function scopeChoicesFrom(choices: NewGameChoices, familyViews: string[] = []): ScopeChoices {
  const other = (Object.entries(choices) as [ChoiceKey, StepChoice | undefined][])
    .flatMap(([key, value]) => (key !== 'sound' && value?.other ? [`${key}: ${value.other}`] : []))
    .join('\n');
  const audio = audioDirectionFrom(choices);
  return {
    genre: labelsFor('genre', choices.genre?.picks ?? []).join(', ') || 'Open-ended',
    vibe: labelsFor('vibe', choices.vibe?.picks ?? []).join(', ') || 'Open-ended',
    family: choices.family?.picks[0] ?? 'any',
    world: labelsFor('world', choices.world?.picks ?? []).join(', ') || 'Open-ended',
    players: choices.players?.picks.includes('multi') ? 'multi' : 'single',
    pov: choices.view?.picks[0] ?? viewsFor(familyViews, choices.genre?.picks ?? [])[0] ?? 'fixed',
    ...(audio ? { audio } : {}),
    ...(other ? { other } : {}),
  };
}

/**
 * The audio direction the Sound step picked, as the contract's direction axes: a style tile's genre and mood, plus any
 * free text. A step with no pick (or a skip) yields no direction, so the game falls back to the tagging defaults.
 */
export function audioDirectionFrom(choices: NewGameChoices): AudioDirection | undefined {
  const choice = choices.sound;
  if (!choice) return undefined;
  const style = audioStyle(choice.picks[0]);
  const direction: AudioDirection = {
    ...(style ? { style: style.style, mood: style.mood } : {}),
    ...(choice.other ? { other: choice.other } : {}),
  };
  return hasAudioDirection(direction) ? direction : undefined;
}

export function choiceLabels(key: ChoiceKey, choice: StepChoice | undefined): string[] {
  if (!choice) return [];
  if (key === 'genre' || key === 'vibe' || key === 'world') return labelsFor(key, choice.picks);
  if (key === 'sound') {
    const labels = new Map<string, string>(AUDIO_STYLES.map(({ id, label }) => [id, label]));
    return choice.picks.map((pick) => labels.get(pick) ?? pick);
  }
  return choice.picks;
}
