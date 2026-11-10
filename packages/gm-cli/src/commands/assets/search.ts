import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ATLAS_PACK, familyFor, formatRow, loadIndex, packOf, search, searchAtlas, setFor } from '@ogm/asset-cards';

import { FILTER_FLAGS, toQuery } from '../../assets-query.js';
import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson, requireAssetsRoot } from '../../context.js';

/** The game's style family and compatibility sets inferred from `./assets.lock.json`. */
function lockContext(cwd: string): { family: string; sets: string[]; packs: string[] } | undefined {
  const file = join(cwd, 'assets.lock.json');
  if (!existsSync(file)) return undefined;
  let lock: { family?: unknown; assets?: unknown };
  try {
    lock = JSON.parse(readFileSync(file, 'utf8')) as { family?: unknown; assets?: unknown };
  } catch {
    throw new UsageError('assets.lock.json is not valid JSON', 'git diff assets.lock.json');
  }
  if (typeof lock.family !== 'string' || !lock.family) {
    throw new UsageError(
      'assets.lock.json has no style family',
      'set "family" in assets.lock.json (gm help assets search)',
    );
  }
  const sets = new Set<string>();
  const packs = new Set<string>();
  if (Array.isArray(lock.assets)) {
    for (const asset of lock.assets) {
      const id =
        typeof asset === 'object' && asset !== null && typeof (asset as { id?: unknown }).id === 'string'
          ? (asset as { id: string }).id
          : undefined;
      const pack = id ? packOf(id) : undefined;
      if (pack) packs.add(pack);
      const set = pack && familyFor(pack) === lock.family ? setFor(pack) : undefined;
      if (set) sets.add(set.id);
    }
  }
  return { family: lock.family, sets: [...sets], packs: [...packs] };
}

export const command: GmCommand = {
  name: 'assets search',
  summary: 'find assets and collections by words and filters (in-game rights by default)',
  usage: '<words...> [filters]',
  example: 'assets search dungeon wall --kind model/kit',
  flags: {
    ...FILTER_FLAGS,
    'any-family': { type: 'boolean', default: false, help: "search outside this game's style family (needs --reason)" },
    reason: { type: 'string', help: "why the search leaves this game's family (logged)" },
  },
  async run(ctx, args, flags) {
    const assetsRoot = requireAssetsRoot(ctx);
    const index = await loadIndex(assetsRoot);
    const q = toQuery('assets search', args, flags);
    // R55: inside a game repo, search stays in the lockfile's family (plus `any`) unless an exception is logged.
    const anyFamily = flags['any-family'] === true;
    const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
    if (anyFamily && !reason) {
      throw new UsageError('--any-family needs --reason', 'gm assets search <words> --any-family --reason "<why>"');
    }
    const lock = lockContext(ctx.cwd);
    const gameFamily = lock?.family;
    // `--family` picks another family for a lineup; leaving the game's family still needs a logged reason.
    const leaves = gameFamily !== undefined && (anyFamily || (q.family !== undefined && q.family !== gameFamily));
    if (leaves && !reason) {
      throw new UsageError(
        `--family ${q.family} is outside this game's family (${gameFamily})`,
        `gm assets search <words> --family ${q.family} --reason "<why>"`,
      );
    }
    if (lock && gameFamily && !anyFamily && !q.family) {
      q.gameFamily = gameFamily;
      if (lock.sets.length > 0) {
        q.gameSets = lock.sets;
        q.gamePacks = lock.packs;
      }
    }
    if (q.sameRigAs && !index.cards.some((card) => card.id === q.sameRigAs)) {
      throw new UsageError(`unknown card id "${q.sameRigAs}"`, 'gm assets search <words> to find an id');
    }
    if (leaves) ctx.emit('assets.family_exception', { family: gameFamily, reason, query: args.join(' ') });
    const atlas = searchAtlas(assetsRoot, index, { ...q, limit: ctx.limit });
    const atlasSubjectPrefix = `t1:${ATLAS_PACK}/subjects/`;
    const indexed = search(
      { ...index, cards: index.cards.filter((card) => !card.id.startsWith(atlasSubjectPrefix)) },
      { ...q, limit: ctx.limit },
    );
    const hits: typeof indexed = [];
    const seen = new Set<string>();
    for (let at = 0; hits.length < ctx.limit && (at < indexed.length || at < atlas.length); at += 1) {
      for (const card of [indexed[at], atlas[at]]) {
        if (card && !seen.has(card.id) && hits.length < ctx.limit) {
          seen.add(card.id);
          hits.push(card);
        }
      }
    }
    for (const card of hits) {
      if (ctx.json) printJson(ctx, card);
      else {
        const subject = packOf(card.id) === ATLAS_PACK ? card.describe?.objects?.[0]?.replaceAll('-', ' ') : undefined;
        ctx.out(`${formatRow(card)}${subject ? `  [subject: ${subject}]` : ''}`);
      }
    }
    if (hits.length === 0 && !ctx.json) ctx.err('no hits. Try: fewer words, --include-draft, or gm assets facets');
    ctx.emit('assets.search', { args, flags: { ...flags, help: undefined }, hits: hits.length });
    return EXIT.ok;
  },
};
