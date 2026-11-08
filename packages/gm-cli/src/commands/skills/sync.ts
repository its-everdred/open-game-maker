import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { recordedSet } from '../../skills/game-lock.js';
import { locateSkillPack, syncSkillPack } from '../../skills/pack.js';

export const command: GmCommand = {
  name: 'skills sync',
  summary: 'refresh the committed Game Maker skill pack without clobbering local edits',
  usage: '[--check] [--force]',
  example: 'skills sync --check',
  flags: {
    check: { type: 'boolean', default: false, help: 'report drift without writing' },
    force: { type: 'boolean', default: false, help: 'replace locally edited installed pack files' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError('gm skills sync takes no arguments', 'gm help skills sync');
    const result = syncSkillPack({
      repoDir: ctx.cwd,
      packDir: locateSkillPack(ctx.cwd, ctx.skillsDir),
      set: recordedSet(ctx.cwd),
      checkOnly: flags.check === true,
      force: flags.force === true,
    });
    if (ctx.json) ctx.out(JSON.stringify(result));
    else if (result.actions.length > 0) result.actions.forEach(ctx.out);
    else ctx.out('skills up to date');
    ctx.emit('skills.sync', { check: flags.check === true, changed: result.changed, drift: result.drift });
    return flags.check === true && result.drift ? EXIT.failed : EXIT.ok;
  },
};
