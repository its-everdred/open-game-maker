import { resolve } from 'node:path';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { requireAssetsRoot } from '../../context.js';
import { printSafeJson, terminalText } from '../../packs/discovery.js';

export const command: GmCommand = {
  name: 'packs assemble',
  summary: 'assemble a Unity prefab or scene into a building model',
  usage:
    '<pack-id> <source-relative-path> (--list | --id <slug> --title <title> [--object <name> | --pieces <ids>]) [--binary2text <path>]',
  example: 'packs assemble example Buildings/House.prefab --id house --title House',
  flags: {
    id: { type: 'string', help: 'building asset slug' },
    title: { type: 'string', help: 'building title' },
    object: { type: 'string', help: 'unique building name or scoped transform ID (required for scenes)' },
    pieces: { type: 'string', help: 'comma-separated scoped transform IDs for modular scene pieces' },
    binary2text: { type: 'string', help: 'path to Unity binary2text for binary assets' },
    list: { type: 'boolean', help: 'list scoped transform IDs and names without exporting' },
  },
  async run(ctx, args, flags) {
    if (flags.list && (flags.id || flags.title || flags.object || flags.pieces)) {
      throw new UsageError('--list cannot be combined with assembly options', 'gm help packs assemble');
    }
    if (args.length !== 2 || (!flags.list && (typeof flags.id !== 'string' || typeof flags.title !== 'string'))) {
      throw new UsageError('pack, source, --id and --title are required', 'gm help packs assemble');
    }
    const { assemblePackBuilding } = await import('../../packs/unity/assemble.js');
    const result = await assemblePackBuilding({
      assetsRoot: requireAssetsRoot(ctx),
      pack: args[0]!,
      source: args[1]!,
      slug: typeof flags.id === 'string' ? flags.id : '',
      title: typeof flags.title === 'string' ? flags.title : '',
      ...(flags.list ? { listOnly: true } : {}),
      ...(typeof flags.object === 'string' ? { objectName: flags.object } : {}),
      ...(typeof flags.pieces === 'string' ? { pieceIds: flags.pieces.split(',').map((id) => id.trim()) } : {}),
      ...(typeof flags.binary2text === 'string' ? { binary2text: resolve(ctx.cwd, flags.binary2text) } : {}),
      ...(ctx.env ? { env: ctx.env } : {}),
    }).catch((error: unknown) => {
      throw new CommandError(terminalText(error instanceof Error ? error.message : String(error)));
    });
    if (result.nodes) {
      if (ctx.json) printSafeJson(ctx, result.nodes);
      else
        for (const node of result.nodes)
          ctx.out(`${terminalText(node.id)}  ${terminalText(node.name)}  ${terminalText(node.parent ?? '')}`);
      return EXIT.ok;
    }
    if (ctx.json) printSafeJson(ctx, result);
    else ctx.out(`${terminalText(result.id)}  ${terminalText(result.output)}`);
    for (const warning of result.warnings) ctx.err(terminalText(warning));
    ctx.emit('packs.assemble', result);
    return EXIT.ok;
  },
};
