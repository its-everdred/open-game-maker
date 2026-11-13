import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { point, readScene, writeScene } from '../../scenery/files.js';

export const command: GmCommand = {
  name: 'scenery add',
  summary: 'place a locked asset in the scenery',
  usage: '<id> <asset-id> --position x,y,z [--layer back|mid|front]',
  flags: {
    position: { type: 'string', help: 'world position x,y,z' },
    layer: { type: 'string', default: 'mid', help: 'back, mid, or front' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 2 || !flags.position)
      throw new UsageError('give an item id, asset id and position', 'gm scenery add <id> <asset-id> --position x,y,z');
    const { scene, assets } = await readScene(ctx.cwd);
    const layer = flags.layer;
    if (layer !== 'back' && layer !== 'mid' && layer !== 'front')
      throw new UsageError('invalid layer', 'use back, mid or front');
    scene.items.push({
      id: args[0]!,
      assetId: args[1]!,
      position: point(flags.position),
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      layer,
    });
    await writeScene(ctx.cwd, scene, assets);
    ctx.out(`placed ${args[0]}`);
    return EXIT.ok;
  },
};
