import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { skillsConfig, type GameSkills } from '@ogm/game-repo-template';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { rolesFor } from '../../skills/catalog.js';
import { recordedSet } from '../../skills/game-lock.js';

// Each `games/<slug>/gm.lock.json` under the instance root, with the set it records (if any).
function instanceGames(root: string): GameSkills[] {
  const games = join(root, 'games');
  if (!existsSync(games)) return [];
  return readdirSync(games, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(games, entry.name, 'gm.lock.json')))
    .map((entry) => {
      const set = recordedSet(join(games, entry.name));
      return set ? { slug: entry.name, set } : { slug: entry.name };
    });
}

export const command: GmCommand = {
  name: 'skills config',
  summary: 'print the aiur agent.skills block mapping game and role labels to mandatory skills',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError('gm skills config takes no arguments', 'gm help skills config');
    const config = skillsConfig(rolesFor(ctx.cwd, ctx.skillsDir), instanceGames(ctx.cwd));
    if (ctx.json) {
      ctx.out(JSON.stringify(config));
      return EXIT.ok;
    }
    ctx.out('agent:');
    ctx.out('  skills:');
    ctx.out(`    preload_max_bytes: ${config.preload_max_bytes}`);
    ctx.out('    by_label:');
    for (const [label, skills] of Object.entries(config.by_label)) ctx.out(`      "${label}": [${skills.join(', ')}]`);
    return EXIT.ok;
  },
};
