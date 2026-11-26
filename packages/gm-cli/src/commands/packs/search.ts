import { loadIndex } from '@ogm/asset-cards';
import { EXIT, type GmCommand } from '../../command.js';
import { requireAssetsRoot } from '../../context.js';
import { discoverPacks, printSafeJson, terminalText } from '../../packs/discovery.js';

export const command: GmCommand = {
  name: 'packs search',
  summary: 'find packs by camera, setting and style',
  usage: '[--camera <camera>] [--setting <setting>] [--style <family>] [--json]',
  example: 'packs search --camera isometric --setting dungeon',
  flags: {
    camera: { type: 'string', help: 'camera supported by the pack' },
    setting: { type: 'string', help: 'setting covered by the pack' },
    style: { type: 'string', help: 'style family or compatibility set' },
  },
  async run(ctx, _args, flags) {
    const packs = discoverPacks(await loadIndex(requireAssetsRoot(ctx)), {
      ...(typeof flags.camera === 'string' ? { camera: flags.camera } : {}),
      ...(typeof flags.setting === 'string' ? { setting: flags.setting } : {}),
      ...(typeof flags.style === 'string' ? { style: flags.style } : {}),
    });
    for (const pack of packs.slice(0, ctx.limit)) {
      if (ctx.json) printSafeJson(ctx, pack);
      else ctx.out(`${terminalText(pack.id)}  ${terminalText(pack.title)}`);
    }
    return EXIT.ok;
  },
};
