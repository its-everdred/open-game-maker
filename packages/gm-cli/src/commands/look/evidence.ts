import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix, relative, resolve, sep } from 'node:path';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { printJson } from '../../context.js';
import { gameDir, workspaceRoot } from '../../outbox.js';

// A media path the body names: in backticks, bold or quotes, as a markdown or <img src> target, in a table cell, or bare.
// A `?query` or `#fragment` after the extension is not part of the path. URLs are skipped (their host keeps them).
const MEDIA =
  /(?:^|[\s`(<[\]"'=*|:])([^\s`()<>[\]"'*|=?#]+?\.(?:png|jpe?g|gif|webp|mp4|webm))(?=$|[\s`)>\]"'*_|:,;.!?#])/gim;

function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The media paths a pull request body links, in order, without duplicates or URLs. */
export function linkedEvidence(body: string): string[] {
  const local = body.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]`]+/gi, ' ');
  const found = [...local.matchAll(MEDIA)].map((match) => match[1]!);
  return [...new Set(found.map(decoded))];
}

/** Regular files committed at HEAD; a symlink is left out, since its target may be a workspace file that goes away. */
function committedFiles(root: string): Set<string> {
  try {
    const listing = execFileSync('git', ['ls-tree', '-r', '-z', '--full-name', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const files = listing
      .split('\0')
      .map((line) => /^100(?:644|755) blob [0-9a-f]+\t(.+)$/.exec(line)?.[1])
      .filter((path) => path !== undefined);
    return new Set(files);
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
