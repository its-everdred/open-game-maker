import { copyFileSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandError, EXIT, type GmCommand } from '../../command.js';
import { readPreferences, renderPreferenceSection, updatePreferenceSection } from '../../preferences.js';
import { bundledPreferences, bundledSkill, preferenceSkill, preferencesDirectory } from './list.js';

export const command: GmCommand = {
  name: 'prefs sync',
  summary: 'refresh the worker section and packaged preferences',
  flags: {},
  async run(ctx) {
    if (preferencesDirectory === bundledPreferences)
      throw new CommandError('gm prefs sync requires the core repository checkout');
    const entries = readPreferences(preferencesDirectory);
    const updated = updatePreferenceSection(readFileSync(preferenceSkill, 'utf8'), entries);
    const names = new Set(entries.map((entry) => `${entry.id}.json`));
    for (const name of readdirSync(bundledPreferences)) {
      if (name.endsWith('.json') && !names.has(name)) unlinkSync(join(bundledPreferences, name));
    }
    for (const name of names) copyFileSync(join(preferencesDirectory, name), join(bundledPreferences, name));
    writeFileSync(bundledSkill, `${renderPreferenceSection(entries)}\n`);
    writeFileSync(preferenceSkill, updated);
    ctx.out('updated gm-core and packaged preferences');
    return EXIT.ok;
  },
};
