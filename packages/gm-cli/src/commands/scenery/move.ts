import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { point, readScene, writeScene } from '../../scenery/files.js';

export const command: GmCommand = {
  name: 'scenery move',
  summary: 'move a placed scenery item',
  usage: '<id> --position x,y,z',
  flags: { position: { type: 'string', help: 'world position x,y,z' } },
  async run(ctx, args, flags) {
    if (args.length !== 1 || !flags.position)
      throw new UsageError('give an item id and position', 'gm scenery move <id> --position x,y,z');
    const { scene, assets } = await readScene(ctx.cwd);
    const item = scene.items.find((candidate) => candidate.id === args[0]);
    if (!item) throw new UsageError(`unknown scenery item ${args[0]}`, 'gm scenery list');
    item.position = point(flags.position);
    await writeScene(ctx.cwd, scene, assets);
    ctx.out(`moved ${item.id}`);
    return EXIT.ok;
  },
};
