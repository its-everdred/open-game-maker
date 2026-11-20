import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { gameDir } from '../../outbox.js';
import { checkImageSlots } from '../../image-slots-check.js';
import { checkLoading } from '../../loading-check.js';

export const command: GmCommand = {
  name: 'check images',
  summary: 'verify creator-visible image variants and safe areas',
  usage: '[--json]',
  example: 'check images',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help check images');
    let game = ctx.cwd;
    try {
      game = gameDir(ctx.cwd);
    } catch {
      // Allow checking a game directory directly.
    }
    const errors = [...(await checkLoading(game)), ...(await checkImageSlots(game))];
    if (ctx.json) ctx.out(JSON.stringify({ ok: errors.length === 0, errors }));
    else errors.forEach(ctx.err);
    return errors.length === 0 ? EXIT.ok : EXIT.failed;
  },
};
