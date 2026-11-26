import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { EXIT, type GmCommand } from '../../command.js';
import { readPreferences, validatePreferences } from '../../preferences.js';

export const bundledPreferences = fileURLToPath(new URL('../../../preferences/', import.meta.url));
export const bundledSkill = fileURLToPath(new URL('../../../preferences-worker.md', import.meta.url));
export const preferencePromptFixture = fileURLToPath(
  new URL('../../../../game-repo-template/test/fixtures/prompt.expected.md', import.meta.url),
);
export const preferencePrompt = fileURLToPath(
  new URL('../../../../game-repo-template/templates/prompt.md.liquid', import.meta.url),
);
export const fallbackSkill = fileURLToPath(
  new URL('../../../../game-repo-template/templates/skills/gm-core/SKILL.md', import.meta.url),
);
const corePreferences = fileURLToPath(new URL('../../../../../preferences/', import.meta.url));
const coreSkill = fileURLToPath(new URL('../../../../../skills/gm-core/SKILL.md', import.meta.url));
export const preferencesDirectory = existsSync(corePreferences) ? corePreferences : bundledPreferences;
export const preferenceSkill = existsSync(coreSkill) ? coreSkill : bundledSkill;

export const command: GmCommand = {
  name: 'prefs list',
  summary: 'list active creator preferences',
  usage: '[--scope <scope>]',
  flags: { scope: { type: 'string', help: 'scope to include alongside all-game preferences' } },
  async run(ctx, _args, flags) {
    const result = validatePreferences(readPreferences(preferencesDirectory));
    if (result.errors.length) {
      result.errors.forEach(ctx.err);
      return EXIT.failed;
    }
    const scope = typeof flags.scope === 'string' ? flags.scope : undefined;
    const entries = result.active.filter((entry) => !scope || entry.scope === 'all' || entry.scope === scope);
    if (ctx.json) ctx.out(JSON.stringify(entries));
    else
      entries.forEach((entry) =>
        ctx.out(
          `${entry.id} (${entry.date}, ${entry.scope}, #${entry.owner_ticket}): ${entry.quote} — ${entry.source}`,
        ),
      );
    return EXIT.ok;
  },
};
