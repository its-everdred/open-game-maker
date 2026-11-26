import { copyFileSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandError, EXIT, type GmCommand } from '../../command.js';
import {
  readPreferences,
  renderPreferenceSection,
  updatePreferenceSection,
  updatePromptPreferenceSection,
} from '../../preferences.js';
import {
  bundledPreferences,
  bundledSkill,
  fallbackSkill,
  preferencePrompt,
  preferencePromptFixture,
  preferenceSkill,
  preferencesDirectory,
} from './list.js';

type SyncPaths = {
  source: string;
  bundle: string;
  skill: string;
  prompt: string;
  fixture: string;
  bundledSkill: string;
  fallbackSkill?: string;
};

export function syncPreferenceCopies(paths: SyncPaths): void {
  if (paths.source === paths.bundle) throw new CommandError('gm prefs sync requires the core repository checkout');
  const entries = readPreferences(paths.source);
  const updated = [paths.skill, paths.fixture].map((path) => ({
    path,
    contents: updatePreferenceSection(readFileSync(path, 'utf8'), entries),
  }));
  if (paths.fallbackSkill)
    updated.push({
      path: paths.fallbackSkill,
      contents: updatePreferenceSection(readFileSync(paths.fallbackSkill, 'utf8'), entries),
    });
  updated.push({
    path: paths.prompt,
    contents: updatePromptPreferenceSection(readFileSync(paths.prompt, 'utf8'), entries),
  });
  const names = new Set(entries.map((entry) => `${entry.id}.json`));
  for (const name of readdirSync(paths.bundle)) {
    if (name.endsWith('.json') && !names.has(name)) unlinkSync(join(paths.bundle, name));
  }
  for (const name of names) copyFileSync(join(paths.source, name), join(paths.bundle, name));
  writeFileSync(paths.bundledSkill, `${renderPreferenceSection(entries)}\n`);
  for (const { path, contents } of updated) writeFileSync(path, contents);
}

export const command: GmCommand = {
  name: 'prefs sync',
  summary: 'refresh the worker section and packaged preferences',
  flags: {},
  async run(ctx) {
    syncPreferenceCopies({
      source: preferencesDirectory,
      bundle: bundledPreferences,
      skill: preferenceSkill,
      prompt: preferencePrompt,
      fixture: preferencePromptFixture,
      bundledSkill,
      fallbackSkill,
    });
    ctx.out('updated gm-core, daemon prompt and packaged preferences');
    return EXIT.ok;
  },
};
