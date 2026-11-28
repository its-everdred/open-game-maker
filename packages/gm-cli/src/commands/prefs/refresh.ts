import { EXIT, type GmCommand } from '../../command.js';
import { readPreferences, refreshInstalledPreferenceSections } from '../../preferences.js';
import { preferencesDirectory } from './list.js';

export const command: GmCommand = {
  name: 'prefs refresh',
  summary: 'refresh installed worker preferences without replacing local context',
  flags: {},
  async run(ctx) {
    const count = refreshInstalledPreferenceSections(readPreferences(preferencesDirectory), ctx.cwd);
    ctx.out(`refreshed ${count} installed gm-core skill file(s)`);
    return EXIT.ok;
  },
};
