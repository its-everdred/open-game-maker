import { resolve } from 'node:path';

import {
  SHEET_MAX,
  cardById,
  isAtlasSpriteId,
  loadIndex,
  materializeAtlasSprite,
  writeSheet,
  type ResolvedCard,
} from '@ogm/asset-cards';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { requireAssetsRoot } from '../../context.js';

export const command: GmCommand = {
  name: 'assets sheet',
  summary: `labelled PNG grid of the cards' existing previews (up to ${SHEET_MAX})`,
  usage: '<id...> [--out sheet.png]',
  example: 'assets sheet t1:kenney-mini-dungeon/character-orc@2.0 --out orc.png',
  flags: { out: { type: 'string', default: 'sheet.png', help: 'PNG to write' } },
  async run(ctx, args, flags) {
    if (args.length === 0) throw new UsageError('no card id given', 'gm assets sheet <id...>');
    if (args.length > SHEET_MAX)
      throw new UsageError(`at most ${SHEET_MAX} ids per sheet`, `gm assets sheet <up to ${SHEET_MAX} ids>`);
    const root = requireAssetsRoot(ctx);
    const index = await loadIndex(root);
    const found = args.map((id) => cardById(root, index, id) ?? { id, missing: true as const });
    const missing = found.filter((card) => 'missing' in card).map((card) => card.id);
    if (missing.length > 0)
      throw new UsageError(`unknown card id ${missing.join(', ')}`, 'gm assets search <words> to find ids');
    const cards = await Promise.all(
      (found as ResolvedCard[]).map(async (card) => {
        if (!isAtlasSpriteId(card.id)) return card;
        return (await materializeAtlasSprite(root, card))?.card ?? card;
      }),
    );
    const out = resolve(ctx.cwd, flags.out as string);
    const { cells } = await writeSheet(root, cards, out);
    if (ctx.json) ctx.out(JSON.stringify({ out, cells }));
    else ctx.out(`wrote ${out} (${cells} cells)`);
    ctx.emit('assets.sheet', { args, out, cells });
    return EXIT.ok;
  },
};
