import { EXIT, type GmCommand } from '../../command.js';
import {
  checkInstalledPreferenceSections,
  checkPreferenceBundle,
  checkPreferenceSection,
  readPreferences,
  validatePreferences,
} from '../../preferences.js';
import { bundledPreferences, bundledSkill, preferenceSkill, preferencesDirectory } from './list.js';

export const command: GmCommand = {
  name: 'prefs check',
  summary: 'validate creator preferences and report unresolved conflicts',
  flags: {},
  async run(ctx) {
    const entries = readPreferences(preferencesDirectory);
    const result = validatePreferences(entries);
    if (result.errors.length === 0)
      result.errors.push(
        ...checkPreferenceSection(entries, preferenceSkill),
        ...checkPreferenceBundle(entries, bundledPreferences, bundledSkill),
        ...checkInstalledPreferenceSections(entries, ctx.cwd),
      );
    if (result.errors.some((error) => error.includes('/skills/gm-core/SKILL.md: preference section is stale')))
      ctx.err('run gm skills sync to refresh installed skills');
    if (result.errors.length) {
      result.errors.forEach(ctx.err);
      return EXIT.failed;
    }
    ctx.out(`preferences ok: ${result.active.length} active`);
    return EXIT.ok;
  },
};
