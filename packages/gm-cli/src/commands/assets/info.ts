import { cardById, loadIndex, type ResolvedCard } from '@ogm/asset-cards';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson, requireAssetsRoot } from '../../context.js';

function size(card: ResolvedCard): string {
  const bounds = card.geometry?.bounds_m;
  if (bounds) return `${bounds.max.map((max, i) => (max - bounds.min[i]).toFixed(2)).join('x')}m`;
  const duration = (card.audio as { duration_s?: number } | undefined)?.duration_s;
  return duration === undefined ? '-' : `${duration}s`;
}

function metadataSummary(card: ResolvedCard): string {
  const blocks = (['sprite', 'rig', 'kit', 'geometry'] as const).filter((block) => card[block] !== undefined);
  return `meta=${blocks.join(',') || '-'}`;
}

/** `id  kind/subkind  size  tris  rig  meta  license  uses`, blank (-) where a kind has no such field. */
function row(card: ResolvedCard): string {
  const kind = card.card_type === 'asset' ? `${card.kind}/${card.subkind}` : 'collection';
  const tris = card.geometry?.triangles === undefined ? '-' : `${card.geometry.triangles}tris`;
  return [
    card.id,
    kind,
    size(card),
    tris,
    card.rig?.rig_id ?? '-',
    metadataSummary(card),
    card.resolved.license,
    card.resolved.rights.uses.join(',') || '-',
  ].join('  ');
}

export const command: GmCommand = {
  name: 'assets info',
  summary: 'one line of facts per card id; --json for the full resolved card',
  usage: '<id...>',
  example: 'assets info t1:kenney-mini-dungeon/character-orc@2.0',
  flags: {},
  async run(ctx, args) {
    if (args.length === 0) throw new UsageError('no card id given', 'gm assets info <id>');
    const root = requireAssetsRoot(ctx);
    const index = await loadIndex(root);
    const found = args.map((id) => cardById(root, index, id) ?? { id, missing: true as const });
    const missing: string[] = [];
    for (const card of found) {
      if ('missing' in card) missing.push(card.id);
      else if (ctx.json) printJson(ctx, card);
      else ctx.out(row(card));
    }
    ctx.emit('assets.info', { args, missing: missing.length });
    if (missing.length > 0)
      throw new UsageError(`unknown card id ${missing.join(', ')}`, 'gm assets search <words> to find ids');
    return EXIT.ok;
  },
};
