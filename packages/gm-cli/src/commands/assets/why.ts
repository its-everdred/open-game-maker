import { cardById, licenseFor, loadIndex } from '@ogm/asset-cards';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { requireAssetsRoot } from '../../context.js';
import { readLock } from '../../lock.js';
import { refusalsForUse, rightsForCard, type RefusalRule } from '../../rules.js';

function verdict(rule: RefusalRule | undefined): string {
  return rule === undefined ? 'ok' : `refused ${rule}`;
}

function publicRepoRule(rights: { audience: string; redistribution: string }): RefusalRule | undefined {
  if (rights.redistribution === 'none') return 'no-redistribution';
  if (rights.audience === 'private') return 'private-in-public';
  return undefined;
}

export const command: GmCommand = {
  name: 'assets why',
  summary: 'explain an asset rights decision and its basis',
  usage: '<id>',
  example: 'assets why t1:kenney-mini-dungeon/character-orc@2.0',
  flags: {},
  async run(ctx, args) {
    if (args.length !== 1) throw new UsageError('why needs exactly one asset id', 'gm assets why <id>');
    const root = requireAssetsRoot(ctx);
    const index = await loadIndex(root);
    const card = cardById(root, index, args[0]!);
    if (!card) throw new UsageError(`unknown card id ${args[0]}`, 'gm assets search <words> to find ids');
    const declared =
      card.rights ?? (card.collection === undefined ? undefined : index.collections[card.collection]?.rights);
    const rights = rightsForCard(card, index.collections);
    ctx.out(
      `${card.id}  ${card.resolved.license}  uses=${rights.uses.join(',')}  audience=${rights.audience}  redistribution=${rights.redistribution}  attribution=${rights.attribution ?? '-'}`,
    );
    for (const basis of declared?.basis ?? []) {
      const setBy = basis.set_by.name ? `${basis.set_by.role}:${basis.set_by.name}` : basis.set_by.role;
      ctx.out(
        `${basis.type}  ${basis.uses.join(',')}  ${basis.audience}  ${basis.redistribution}  ${setBy}  ${basis.date}  ${basis.note ?? '-'}`,
      );
    }
    const note = licenseFor(card.resolved.license)?.note;
    if (note) ctx.out(`license note: ${note}`);
    const lock = await readLock(ctx.cwd);
    const draft = refusalsForUse(card, lock, { placeholder: true })[0]?.rule;
    const published = refusalsForUse(card, lock, { placeholder: false })[0]?.rule;
    ctx.out(`use in draft: ${verdict(draft)}`);
    ctx.out(`use in published: ${verdict(published)}`);
    ctx.out(`public repo: ${verdict(publicRepoRule(rights))}`);
    ctx.emit('assets.why', { id: card.id });
    return EXIT.ok;
  },
};
