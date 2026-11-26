import { EXIT, type GmCommand } from '../../command.js';
import {
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
      );
    if (result.errors.length) {
      result.errors.forEach(ctx.err);
      return EXIT.failed;
    }
    ctx.out(`preferences ok: ${result.active.length} active`);
    return EXIT.ok;
  },
};
