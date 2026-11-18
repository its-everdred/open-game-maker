import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gameManifestSchema } from '@ogm/contracts';
import { botKeys, type BotKey } from '@ogm/gm-verify';
import { z } from 'zod';

export type PlaytestMode = { id: string; taps: string[] };

const sourceManifestSchema = z.looseObject({
  modes: gameManifestSchema.shape.modes,
  controlBindings: gameManifestSchema.shape.controlBindings,
  playArea: z.union([z.literal(false), z.looseObject({ tap: z.string().optional() })]).optional(),
});

/**
 * The modes `gm qa playtest` plays and the keys its bot may press, from the game's `gm.manifest.json`. A game that
 * lists no modes yet is played once along its `playArea.tap` path, with a note saying so.
 */
export function readPlaytestPlan(
  game: string,
  choice: { all: boolean; mode?: string },
): { modes: PlaytestMode[]; keys: BotKey[]; board: boolean; notes: string[] } {
  const path = join(game, 'gm.manifest.json');
  if (!existsSync(path)) throw new Error(`no gm.manifest.json in ${game}`);
  const parsed = sourceManifestSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`gm.manifest.json: ${z.prettifyError(parsed.error).replace(/\s*\n\s*/g, ' ')}`);
  const manifest = parsed.data;
  const notes: string[] = [];
  const taps = (tap: string) => tap.split('>').map((text) => text.trim());
  let modes: PlaytestMode[] = (manifest.modes ?? []).map((mode) => ({ id: mode.id, taps: taps(mode.tap) }));
  if (!modes.length) {
    const tap = manifest.playArea ? manifest.playArea.tap : undefined;
    modes = [{ id: 'play', taps: tap ? taps(tap) : [] }];
    notes.push('gm.manifest.json lists no modes: played one path only; add "modes" to cover every mode');
  }
  if (choice.mode !== undefined) {
    const mode = modes.find((item) => item.id === choice.mode);
    if (!mode) throw new Error(`no mode ${choice.mode}; modes: ${modes.map((item) => item.id).join(', ')}`);
    modes = [mode];
  } else if (!choice.all) modes = modes.slice(0, 1);
  const keys = botKeys(manifest.controlBindings);
  if (!keys.length) notes.push('no controlBindings: the bot taps the board instead of pressing keys');
  return { modes, keys, board: manifest.playArea !== false, notes };
}
