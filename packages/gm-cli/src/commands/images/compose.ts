import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { gameDir } from '../../outbox.js';
import { composeSlots } from '../../image-compose.js';

export const command: GmCommand = {
  name: 'images compose',
  summary: 'compose layered image slot variants for every viewport',
  usage: '',
  example: 'images compose',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help images compose');
    let game = ctx.cwd;
    try {
      game = gameDir(ctx.cwd);
    } catch {
      // Allow running directly from a game directory.
    }
    try {
      const paths = await composeSlots(game);
      if (ctx.json) ctx.out(JSON.stringify({ paths }));
      else paths.forEach(ctx.out);
      return EXIT.ok;
    } catch (error) {
      ctx.err(error instanceof Error ? error.message : String(error));
      return EXIT.failed;
    }
  },
};
