import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { buildLiveSnapshot } from '../../live-build.js';
import { gameDir, workspaceRoot } from '../../outbox.js';

export const command: GmCommand = {
  name: 'live-build',
  summary: 'build a completed snapshot for a live prototype',
  usage: '',
  flags: {},
  async run(ctx, args) {
    if (args.length) throw new UsageError('gm live-build takes no arguments', 'gm help live-build');
    const root = workspaceRoot(ctx.cwd);
    const game = gameDir(ctx.cwd, root);
    if (!existsSync(join(game, 'gm.manifest.json')) || !existsSync(join(game, 'package.json')))
      throw new UsageError('not inside a game folder', 'run gm live-build from the game folder');
    try {
      await buildLiveSnapshot(game, ctx.env ?? {});
    } catch (error) {
      throw new CommandError(error instanceof Error ? error.message : String(error));
    }
    ctx.out('live build ready');
    return EXIT.ok;
  },
};
