import { readFileSync } from 'node:fs';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { catalogRoot, mandatoryFor, readCatalog, rolesFor } from '../../skills/catalog.js';

export const command: GmCommand = {
  name: 'skills show',
  summary: "print a skill's SKILL.md and the role labels that make it mandatory",
  usage: '<name>',
  example: 'skills show gm-audio',
  flags: {},
  async run(ctx, args) {
    if (args.length !== 1) throw new UsageError('gm skills show takes one skill name', 'gm help skills show');
    const name = args[0]!;
    const entry = readCatalog(catalogRoot(ctx.cwd, ctx.skillsDir)).find((candidate) => candidate.name === name);
    if (!entry) throw new UsageError(`no skill named ${name}`, `gm skills search ${name}`);
    const roles = mandatoryFor(rolesFor(ctx.cwd, ctx.skillsDir), name);
    const text = readFileSync(entry.file, 'utf8');
    if (ctx.json) {
      ctx.out(JSON.stringify({ name, description: entry.description, mandatoryFor: roles, text }));
      return EXIT.ok;
    }
    if (roles.length > 0) ctx.out(`mandatory for: ${roles.join(', ')}`);
    ctx.out(text.trimEnd());
    return EXIT.ok;
  },
};
