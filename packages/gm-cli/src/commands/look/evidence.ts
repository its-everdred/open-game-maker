import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix, relative, resolve, sep } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { gameDir, workspaceRoot } from '../../outbox.js';

// A media path the body names: in backticks, as a markdown link target, or bare. URLs are skipped (their host keeps them).
const MEDIA = /(?:^|[\s`(<[])([^\s`()<>[\]"']+\.(?:png|jpe?g|gif|webp|mp4|webm))(?=$|[\s`)>\]:,;.])/gim;

/** The media paths a pull request body links, in order, without duplicates or URLs. */
export function linkedEvidence(body: string): string[] {
  const found = [...body.matchAll(MEDIA)].map((match) => match[1]!).filter((path) => !path.includes('://'));
  return [...new Set(found)];
}

function committedFiles(root: string): Set<string> {
  try {
    const listing = execFileSync('git', ['ls-tree', '-r', '--name-only', '--full-name', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return new Set(listing.split('\n').filter(Boolean));
  } catch {
    throw new UsageError('HEAD has no commit to check', 'commit the evidence, then run gm look evidence');
  }
}

export const command: GmCommand = {
  name: 'look evidence',
  summary: 'fail when the pull request body links a sheet, still or clip that is not committed at HEAD',
  usage: '--body <file>',
  example: 'look evidence --body pr-body.md',
  flags: {
    body: { type: 'string', help: 'the pull request body, as a markdown file' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help look evidence');
    if (typeof flags.body !== 'string') throw new UsageError('--body is required', 'gm look evidence --body <file>');
    const bodyFile = resolve(ctx.cwd, flags.body);
    if (!existsSync(bodyFile)) throw new UsageError(`no body at ${flags.body}`, 'gm look evidence --body <file>');
    const root = workspaceRoot(ctx.cwd);
    const game = relative(root, gameDir(ctx.cwd, root)).split(sep).join('/');
    const committed = committedFiles(root);
    const linked = linkedEvidence(readFileSync(bodyFile, 'utf8'));
    // A path counts when HEAD holds it from the repository root or from the game's folder (`review/210/a.png`).
    const missing = linked.filter((path) => {
      if (posix.isAbsolute(path)) return true;
      return ![path, posix.join(game, path)].some((candidate) => {
        const normal = posix.normalize(candidate);
        return !normal.startsWith('../') && committed.has(normal);
      });
    });
    const ok = missing.length === 0;
    if (ctx.json) printJson(ctx, { ok, linked, missing });
    else {
      for (const path of missing)
        ctx.err(
          `missing ${path}: not committed at HEAD; workspace files (assets-local/, shots/) are deleted after merge, ` +
            'so copy it into review/<ticket>/ in the game folder, commit it and link that path',
        );
      if (ok) ctx.out(`evidence ok: ${linked.length} linked files committed`);
    }
    return ok ? EXIT.ok : EXIT.failed;
  },
};
