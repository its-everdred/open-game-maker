import type { GameManifest } from '@ogm/contracts/game';

/** One warning per host-drawn touch button without a declared icon; the overlay then guesses one from its name. */
export function touchIconWarnings(manifest: GameManifest): string[] {
  if (manifest.inputs.touch === 'self') return [];
  return Object.entries(manifest.inputs.actions)
    .filter(([action, kind]) => kind === 'button' && !manifest.inputs.icons?.[action])
    .map(([action]) => `touch button ${action} has no icon in inputs.icons; the overlay picks one from its name`);
}
