import type { GameManifest } from '@ogm/contracts';

type Item = GameManifest['palette']['items'][number];

/** Included scope entries are requests, never claims that an asset is already in the game. */
export function scopePaletteItems(scope: { scope: { included: string[] } }): Item[] {
  return scope.scope.included.map((entry, index) => {
    const label = entry.trim().slice(0, 200);
    const category = /\b(audio|music|sound|voice|sfx)\b/i.test(label)
      ? 'audio'
      : /\b(character|characters|creature|creatures|player|players|goblin|goblins|enemy|enemies)\b/i.test(label)
        ? 'characters'
        : /\b(scene|scenery|forest|tree|trees|terrain|landscape|world|environment|level)\b/i.test(label)
          ? 'scenery'
          : 'props';
    return { prefab: `scope:${index}`, label, category };
  });
}
