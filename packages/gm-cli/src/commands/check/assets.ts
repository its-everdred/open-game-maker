import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { cardById, loadIndex } from '@ogm/asset-cards';
import type { BoundaryVerdict } from '@ogm/contracts';

import { EXIT, type GmCommand } from '../../command.js';
import { repoVisibility, requireAssetsRoot } from '../../context.js';
import { readLock } from '../../lock.js';
import { scanReferences, unlisted, type References } from '../../references.js';
import { repoPaths, resolveEntry } from '../../resolve.js';
import { refusalsForCheck, rightsForCard, type Refusal } from '../../rules.js';

async function assetFiles(cwd: string): Promise<string[]> {
  const root = join(cwd, 'assets');
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(cwd, join(entry.parentPath, entry.name)).replaceAll(sep, '/'))
    .sort();
}

/** Every asset id the game's code names must be on its list: the list is what the build ships. */
function unlistedRefusals(listed: string[], references: References): Refusal[] {
  return unlisted(listed, references).map(({ id, file }) => ({
    code: 'rights',
    rule: 'unlisted',
    id,
    path: file,
    detail: `${file} uses it but assets.lock.json does not list it. Try: gm assets ${id.startsWith('t3:') ? 'register <path>' : `use ${id}`}`,
  }));
}

function printRefusals(ctx: Parameters<GmCommand['run']>[0], refusals: Refusal[], json: boolean): void {
  const reasons: BoundaryVerdict['reasons'] = refusals.map((item) => ({
    code: 'rights',
    path: item.path,
    detail: `${item.id} ${item.rule} ${item.detail}`,
  }));
  if (json) ctx.out(JSON.stringify({ allowed: reasons.length === 0, reasons } satisfies BoundaryVerdict));
  else for (const item of refusals) ctx.err(`${item.id}  ${item.rule}  ${item.detail}`);
}

export const command: GmCommand = {
  name: 'check assets',
  summary: 'verify asset files, lock integrity, publish rights, and that the code uses only listed assets',
  usage: '[--publish] [--repo-visibility public|private] [--json]',
  example: 'check assets --publish --repo-visibility public',
  flags: {
    publish: { type: 'boolean', default: false, help: 'apply publish-time rights rules' },
    'repo-visibility': { type: 'string', help: 'public or private repository visibility' },
  },
  async run(ctx, _args, flags) {
    const files = await assetFiles(ctx.cwd);
    const references = await scanReferences(ctx.cwd);
    let lock;
    try {
      lock = await readLock(ctx.cwd);
    } catch (error) {
      const refusals: Refusal[] = [
        {
          code: 'rights',
          rule: 'stale-rights',
          id: 'assets.lock.json',
          detail: error instanceof Error ? error.message : String(error),
        },
      ];
      printRefusals(ctx, refusals, ctx.json);
      ctx.emit('assets.check', { publish: flags.publish === true, violations: refusals.length });
      return EXIT.failed;
    }
    if (lock === null) {
      const refusals = files.map<Refusal>((path) => ({
        code: 'rights',
        rule: 'unknown-id',
        id: path,
        path,
        detail: 'file is not represented in assets.lock.json',
      }));
      refusals.push(...unlistedRefusals([], references));
      if (refusals.length === 0 && !ctx.json) ctx.out('no assets');
      printRefusals(ctx, refusals, ctx.json);
      ctx.emit('assets.check', { publish: flags.publish === true, violations: refusals.length });
      return refusals.length === 0 ? EXIT.ok : EXIT.failed;
    }

    const assetsRoot = lock.assets.some((entry) => !entry.id.startsWith('t3:')) ? requireAssetsRoot(ctx) : null;
    const index = assetsRoot ? await loadIndex(assetsRoot) : null;
    const collections = index?.collections ?? {};
    const byId = new Map((index?.cards ?? []).map((card) => [card.id, card]));
    const publish = flags.publish === true;
    const currentVisibility = await repoVisibility(ctx.cwd, flags['repo-visibility']);
    /* `gm build assets` resolves files itself so a missing one fails only that asset; it passes `skipFiles`. */
    const checkFiles = flags.skipFiles !== true;
    const refusals: Refusal[] = [];
    for (const entry of lock.assets) {
      const card = byId.get(entry.id) ?? (assetsRoot && index ? cardById(assetsRoot, index, entry.id) : undefined);
      if (card) byId.set(card.id, card);
      if (checkFiles) {
        const resolution = await resolveEntry(entry, {
          cwd: ctx.cwd,
          assetsRoot: ctx.assetsRoot,
          blobRoot: ctx.blobRoot,
          collections,
        });
        if (!resolution.ok) {
          refusals.push({
            code: 'rights',
            rule: resolution.rule,
            id: entry.id,
            path: entry.path,
            detail: `${resolution.detail}. Try: ${resolution.fix}`,
          });
        }
      }
      refusals.push(
        ...refusalsForCheck(
          entry,
          card,
          /* The file rules ran above against the entry's source; only the rights rules apply here. */
          { exists: true, sha256: entry.sha256 },
          {
            publish,
            visibility: currentVisibility,
            ...(card ? { currentRights: rightsForCard(card, collections) } : {}),
          },
        ).map((item) => ({ ...item, path: entry.path })),
      );
    }
    const lockedPaths = new Set(lock.assets.flatMap((entry) => repoPaths(entry, byId.get(entry.id))));
    for (const path of files.filter((file) => !lockedPaths.has(file))) {
      refusals.push({
        code: 'rights',
        rule: 'unknown-id',
        id: path,
        path,
        detail: 'file is not represented in assets.lock.json',
      });
    }
    refusals.push(
      ...unlistedRefusals(
        lock.assets.map((entry) => entry.id),
        references,
      ),
    );
    printRefusals(ctx, refusals, ctx.json);
    ctx.emit('assets.check', { publish, violations: refusals.length });
    return refusals.length === 0 ? EXIT.ok : EXIT.failed;
  },
};
