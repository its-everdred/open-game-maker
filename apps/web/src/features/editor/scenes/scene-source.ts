import { getEditorScenes } from '../api';

/**
 * Where the editor's scene strip gets its scenes: the game's scene documents (#1207: `scenes/<scene>.scene.json` heads
 * and their revision logs). A review link (`?mode=edit&scenes=fixture`) shows Dusk Helm's scenarios as sample scenes.
 */

/** One card in the strip, read from a scene head and its last revision. */
export type SceneCard = {
  /** The scene document id (`SceneDoc.scene`). */
  id: string;
  title: string;
  /** The head revision (`SceneHead.rev`); 0 for a scene nobody has saved yet. */
  rev: number;
  /** Who wrote the head revision (`SceneRevision.author`): a creator slug such as `kevin`, or `agent:<ticket>`. */
  author: string;
  thumbnail?: string;
  /** An agent is changing this scene right now. */
  live?: boolean;
  /** Until the game loads scene documents, the game scenario that shows this scene. */
  scenario?: string;
};

const FIXTURES: Record<string, readonly Omit<SceneCard, 'title'>[]> = {
  'dusk-helm': [
    { id: 'graveyard-landmark', rev: 7, author: 'kevin', scenario: 'graveyard-landmark' },
    { id: 'lush-fields', rev: 3, author: 'agent:1208', scenario: 'lush-fields' },
    { id: 'goblin-cave', rev: 5, author: 'agent:1208', live: true, scenario: 'goblin-cave' },
    { id: 'miniboss-arena', rev: 2, author: 'agent:1208', scenario: 'miniboss-arena' },
  ],
};

/** `source` is the page's `?scenes=` value. */
export async function loadScenes(gameId: string, source: string | null): Promise<SceneCard[]> {
  if (source === 'fixture') return (FIXTURES[gameId] ?? []).map((scene) => ({ ...scene, title: sceneTitle(scene.id) }));
  try {
    const { scenes } = await getEditorScenes(gameId);
    return scenes.map(({ id, rev, author }) => ({ id, title: sceneTitle(id), rev, author }));
  } catch {
    /* A game with no checkout to read has no scenes to list; the strip stays out of the way. */
    return [];
  }
}

/**
 * Whether + can make a scene. Not yet: the editor can't write a scene document, and the game can't load one, so a new
 * chip would vanish on reload while the game kept showing the last scenario.
 */
export function canCreateScene(): boolean {
  return false;
}

/** A new, empty scene owned by the creator. */
export function newScene(existing: readonly SceneCard[]): SceneCard {
  const ids = new Set(existing.map((scene) => scene.id));
  let n = existing.length + 1;
  while (ids.has(`scene-${n}`)) n += 1;
  return { id: `scene-${n}`, title: `Scene ${n}`, rev: 0, author: 'kevin' };
}

export function isAgent(author: string): boolean {
  return author.startsWith('agent:');
}

/** Scene ids are readable slugs (`goblin-cave`); the card shows them as words. */
export function sceneTitle(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
