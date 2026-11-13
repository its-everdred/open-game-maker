import { EXIT, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { readScene } from '../../scenery/files.js';

export const command: GmCommand = {
  name: 'scenery list',
  summary: 'list the placed scenery in this game',
  flags: {},
  async run(ctx) {
    const { scene } = await readScene(ctx.cwd);
    if (ctx.json) printJson(ctx, scene);
    else
      for (const item of scene.items) ctx.out(`${item.id}  ${item.assetId}  ${item.position.join(',')}  ${item.layer}`);
    return EXIT.ok;
  },
};
