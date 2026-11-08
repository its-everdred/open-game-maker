import { existsSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { reviewScreens, SCREEN, sheetPath } from '../../look/screens.js';
import { gameDir } from '../../outbox.js';

export const command: GmCommand = {
  name: 'look sheet',
  summary: "put a screen's still beside its approved target render, for gm look check",
  usage: '<screen> --still <png> [--target <png>]',
  example: 'look sheet select --still shots/tablet/t2.png',
  flags: {
    still: { type: 'string', help: 'the still of this screen, from gm run' },
    target: { type: 'string', help: 'the approved render (default: the screen in review/decisions.json)' },
  },
  async run(ctx, args, flags) {
    const [screen, extra] = args;
    if (screen === undefined || extra !== undefined || !SCREEN.test(screen))
      throw new UsageError('name one screen (lowercase letters, digits and -)', 'gm look sheet select --still <png>');
    if (typeof flags.still !== 'string')
      throw new UsageError('--still is required', 'gm look sheet select --still <png>');
    const game = gameDir(ctx.cwd);
    let target: string | undefined;
    if (typeof flags.target === 'string') target = resolve(ctx.cwd, flags.target);
    else {
      let screens;
      try {
        screens = reviewScreens(game);
      } catch (error) {
        throw new UsageError(error instanceof Error ? error.message : String(error), 'fix review/decisions.json');
      }
      const found = screens.find((entry) => entry.name === screen);
      if (!found)
        throw new UsageError(
          `review/decisions.json has no approved target for "${screen}"`,
          `gm look sheet ${screen} --still <png> --target <approved render>`,
        );
      target = resolve(game, found.target);
    }
    const still = resolve(ctx.cwd, flags.still);
    for (const [name, path] of [
      ['still', still],
      ['target', target],
    ] as const)
      if (!existsSync(path)) throw new UsageError(`no ${name} at ${relative(ctx.cwd, path)}`, 'gm help look sheet');
    const out = resolve(game, sheetPath(screen));
    const verify = await import('@ogm/gm-verify');
    try {
      mkdirSync(dirname(out), { recursive: true });
      verify.sideBySide([still, target], out, false);
    } catch (error) {
      if (error instanceof verify.FfmpegMissingError) throw new UsageError(error.message, verify.FFMPEG_HINT);
      ctx.err(error instanceof Error ? error.message : String(error));
      return EXIT.failed;
    }
    const shown = relative(ctx.cwd, out);
    if (ctx.json)
      printJson(ctx, { screen, sheet: shown, still: relative(ctx.cwd, still), target: relative(ctx.cwd, target) });
    else ctx.out(`wrote ${shown}: look at it (gm-verify step 6), then gm look check`);
    return EXIT.ok;
  },
};
