import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { checkControls } from '../../controls-check.js';
import { findControlsGame } from '../../controls-manifest.js';
import { gameDir } from '../../outbox.js';

export const command: GmCommand = {
  name: 'check controls',
  summary: 'verify host control declarations and detect common game-drawn controls',
  usage: '[--json]',
  example: 'check controls',
  flags: {},
  async run(ctx, args) {
    if (args.length) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help check controls');
    let game = ctx.cwd;
    try {
      game = gameDir(ctx.cwd);
    } catch {
      // A standalone game directory is also valid.
    }
    const errors = checkControls(findControlsGame(ctx.cwd) ?? game);
    if (ctx.json) ctx.out(JSON.stringify({ ok: errors.length === 0, errors }));
    else errors.forEach(ctx.err);
    return errors.length ? EXIT.failed : EXIT.ok;
  },
};
