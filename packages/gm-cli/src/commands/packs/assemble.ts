import { resolve } from 'node:path';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { requireAssetsRoot } from '../../context.js';
import { printSafeJson, terminalText } from '../../packs/discovery.js';

export const command: GmCommand = {
  name: 'packs assemble',
  summary: 'assemble a Unity prefab or scene into a building model',
  usage: '<pack-id> <source-relative-path> --id <slug> --title <title> [--object <name>] [--binary2text <path>]',
  example: 'packs assemble example Buildings/House.prefab --id house --title House',
  flags: {
    id: { type: 'string', help: 'building asset slug' },
    title: { type: 'string', help: 'building title' },
    object: { type: 'string', help: 'unique building name or scoped transform ID (required for scenes)' },
    binary2text: { type: 'string', help: 'path to Unity binary2text for binary assets' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 2 || typeof flags.id !== 'string' || typeof flags.title !== 'string') {
      throw new UsageError('pack, source, --id and --title are required', 'gm help packs assemble');
    }
    const { assemblePackBuilding } = await import('../../packs/unity/assemble.js');
    const result = await assemblePackBuilding({
      assetsRoot: requireAssetsRoot(ctx),
      pack: args[0]!,
      source: args[1]!,
      slug: flags.id,
      title: flags.title,
      ...(typeof flags.object === 'string' ? { objectName: flags.object } : {}),
      ...(typeof flags.binary2text === 'string' ? { binary2text: resolve(ctx.cwd, flags.binary2text) } : {}),
      ...(ctx.env ? { env: ctx.env } : {}),
    }).catch((error: unknown) => {
      throw new CommandError(terminalText(error instanceof Error ? error.message : String(error)));
    });
    if (ctx.json) printSafeJson(ctx, result);
    else ctx.out(`${terminalText(result.id)}  ${terminalText(result.output)}`);
    for (const warning of result.warnings) ctx.err(terminalText(warning));
    ctx.emit('packs.assemble', result);
    return EXIT.ok;
  },
};
