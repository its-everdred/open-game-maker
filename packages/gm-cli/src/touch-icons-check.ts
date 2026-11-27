import type { GameManifest } from '@ogm/contracts/game';

/** One warning per host-drawn touch button without a declared icon; the overlay then guesses one from its name. */
export function touchIconWarnings(manifest: GameManifest): string[] {
  if (manifest.inputs.touch === 'self') return [];
  const icons = manifest.inputs.icons ?? {};
  /* The host overlay draws only the first five buttons (packages/host/src/overlay.ts). */
  return Object.entries(manifest.inputs.actions)
    .filter(([, kind]) => kind === 'button')
    .slice(0, 5)
    .filter(([action]) => !Object.hasOwn(icons, action))
    .map(([action]) => `touch button ${action} has no icon in inputs.icons; the overlay picks one from its name`);
}
