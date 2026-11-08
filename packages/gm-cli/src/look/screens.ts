import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The game's review decisions: `review/decisions.json` in the game folder records, per screen, the render the creator
 * approved (`{"screens": {"select": {"target": "review/mock-matrix/select.png", ...}}}`; other fields are free notes).
 * Every screen named there needs a sheet, its current still beside that target, before `gm look check` passes.
 */
export const DECISIONS = join('review', 'decisions.json');
export const SCREEN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type Screen = { name: string; target: string };

/** The screens with an approved target, sorted; [] when the game has no decisions file yet. */
export function reviewScreens(game: string): Screen[] {
  const file = join(game, DECISIONS);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { screens?: Record<string, { target?: unknown }> };
  const screens = Object.entries(parsed.screens ?? {}).map(([name, entry]) => {
    if (!SCREEN.test(name)) throw new Error(`${DECISIONS}: screen "${name}" must be lowercase letters, digits and -`);
    if (typeof entry?.target !== 'string' || entry.target === '')
      throw new Error(`${DECISIONS}: screen "${name}" has no target render`);
    return { name, target: entry.target };
  });
  return screens.sort((a, b) => a.name.localeCompare(b.name));
}

/** Where a screen's sheet lives, relative to the game folder. */
export function sheetPath(screen: string): string {
  return join('look', `${screen}.sheet.png`);
}
