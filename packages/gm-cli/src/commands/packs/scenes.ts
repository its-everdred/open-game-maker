import { loadIndex } from '@ogm/asset-cards';
import { EXIT, type GmCommand } from '../../command.js';
import { requireAssetsRoot } from '../../context.js';
import { discoverPacks, printSafeJson, terminalText } from '../../packs/discovery.js';

export const command: GmCommand = {
  name: 'packs scenes',
  summary: 'find pre-assembled pack scenes',
  usage: '[--setting <setting>] [--json]',
  example: 'packs scenes --setting tavern',
  flags: { setting: { type: 'string', help: 'scene setting' } },
  async run(ctx, _args, flags) {
    const setting = typeof flags.setting === 'string' ? flags.setting : undefined;
    let emitted = 0;
    for (const pack of discoverPacks(await loadIndex(requireAssetsRoot(ctx)), {})) {
      for (const scene of pack.scenes ?? []) {
        if (setting && !scene.settings.includes(setting as (typeof scene.settings)[number])) continue;
        if (emitted >= ctx.limit) return EXIT.ok;
        emitted += 1;
        if (ctx.json) printSafeJson(ctx, { pack: pack.id, ...scene });
        else
          ctx.out(
            `${terminalText(pack.id)}  ${terminalText(scene.path)}  ${terminalText(scene.preview ?? '(no preview)')}`,
          );
      }
    }
    return EXIT.ok;
  },
};
