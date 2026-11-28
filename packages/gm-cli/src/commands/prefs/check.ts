import { existsSync } from 'node:fs';
import { EXIT, type GmCommand } from '../../command.js';
import { gameDir, workspaceRoot } from '../../outbox.js';
import { findPlayAreaGame } from '../../play-area-config.js';
import {
  checkInstalledPreferenceSections,
  checkPreferenceBundle,
  checkPromptPreferenceSection,
  checkPreferenceSection,
  readPreferences,
  validatePreferences,
} from '../../preferences.js';
import {
  bundledPreferences,
  bundledSkill,
  fallbackSkill,
  preferencePrompt,
  preferenceSkill,
  preferencesDirectory,
} from './list.js';

export const command: GmCommand = {
  name: 'prefs check',
  summary: 'validate creator preferences and report unresolved conflicts',
  flags: {},
  async run(ctx) {
    const entries = readPreferences(preferencesDirectory);
    let game = ctx.cwd;
    try {
      const root = workspaceRoot(ctx.cwd);
      game = gameDir(ctx.cwd, root);
    } catch {
      // Outside a repository, there is no enclosing game workspace.
    }
    const requireSkill = findPlayAreaGame(ctx.cwd, game) !== undefined;
    const result = validatePreferences(entries);
    if (result.errors.length === 0)
      result.errors.push(
        ...checkPreferenceSection(entries, preferenceSkill),
        ...checkPreferenceBundle(entries, bundledPreferences, bundledSkill),
        ...checkInstalledPreferenceSections(entries, ctx.cwd, requireSkill),
      );
    if (result.errors.length === 0 && existsSync(preferencePrompt))
      result.errors.push(...checkPromptPreferenceSection(entries, preferencePrompt));
    if (result.errors.length === 0 && existsSync(fallbackSkill))
      result.errors.push(
        ...checkPreferenceSection(entries, fallbackSkill).map(() => 'fallback gm-core preference section is stale'),
      );
    if (result.errors.some((error) => error.includes('/skills/gm-core/SKILL.md: preference section is stale')))
      ctx.err('update the CLI and skill pack before refreshing installed preferences');
    if (result.errors.length) {
      result.errors.forEach(ctx.err);
      return EXIT.failed;
    }
    ctx.out(`preferences ok: ${result.active.length} active`);
    return EXIT.ok;
  },
};
