import { readTemplate } from './files.js';

// OGM-034's `DaemonFiles`: written to the daemon directory's `.aiur/`, never committed.
export type DaemonFiles = { hooks: string; prompt: string };

export type DaemonFilesContext = {
  // The game this daemon builds. Present for every game daemon in an instance repo; absent for the
  // whole-repo fallback the game-repo template still renders.
  gameSlug?: string;
  publishHost?: { helper: string; assetsRoot: string; blobRoot: string };
};

// Directory roots a game daemon checks out beside its own game folder. Cone-mode sparse checkout always keeps the
// repository's root files (package.json, pnpm-workspace.yaml, lockfile, tsconfig.base.json, .npmrc), so this is the
// "root config" the instance repo needs to install and typecheck.
const SHARED_ROOTS = ['packages'] as const;

const CLONE = '%%CLONE%%';
const GAME_SCOPE = '%%GAME_SCOPE%%';
const PUBLISH_HOST = '%%PUBLISH_HOST%%';

/**
 * The same text for every game repo, except when a game slug is given: then the hook clones the instance repository
 * sparsely (this game plus the shared roots) and the prompt carries the game-scope rules.
 */
export function renderDaemonFiles(context: DaemonFilesContext = {}): DaemonFiles {
  const gameSlug = context.gameSlug?.trim();
  if (gameSlug === undefined || gameSlug === '') {
    return {
      hooks: replaceLine(
        replaceLine(readTemplate('hooks.sh'), CLONE, plainClone()),
        PUBLISH_HOST,
        publishHost(context),
      ),
      prompt: withoutLine(readTemplate('prompt.md.liquid'), GAME_SCOPE),
    };
  }
  return {
    hooks: replaceLine(
      replaceLine(readTemplate('hooks.sh'), CLONE, sparseClone(gameSlug)),
      PUBLISH_HOST,
      publishHost(context),
    ),
    prompt: replaceLine(readTemplate('prompt.md.liquid'), GAME_SCOPE, gameScope(gameSlug)),
  };
}

// The instance repo's games/<slug>/ plus the shared roots; cone mode leaves the other games' folders out of the
// working tree, so a daemon cannot read or edit another game's files by accident.
export function sparsePaths(gameSlug: string): string[] {
  return [`games/${gameSlug}`, ...SHARED_ROOTS];
}

// A partial clone fetches no file contents until a path is wanted, so a daemon never downloads the other games.
function sparseClone(gameSlug: string): string {
  return [
    'git clone --sparse --filter=blob:none "$THIS_REPOSITORY_URL" .',
    `git sparse-checkout set ${sparsePaths(gameSlug).join(' ')}`,
  ].join('\n');
}

function plainClone(): string {
  return 'git clone "$THIS_REPOSITORY_URL" .';
}

export function gameScope(gameSlug: string): string {
  return [
    '## Game scope',
    '',
    `- This daemon builds one game: \`games/${gameSlug}/\`. Write only inside \`games/${gameSlug}/\`.`,
    '- The checkout is a sparse checkout of the instance repository: your game, `packages/` and the root config.',
    '  Other games are not checked out; never create or edit their folders.',
    '- If the work needs a change to a shared package under `packages/` or to another game, stop and open a separate',
    '  GitHub issue for the executor describing the change. Do not make that change here.',
  ].join('\n');
}

function publishHost(context: DaemonFilesContext): string {
  const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
  if (!context.publishHost)
    return 'publish_helper="${OGM_PUBLISH_STAGER:-}"\npublish_assets="${OGM_PUBLISH_ASSETS:-}"\npublish_blobs="${OGM_PUBLISH_BLOBS:-}"';
  return `publish_helper=${quote(context.publishHost.helper)}\npublish_assets=${quote(context.publishHost.assetsRoot)}\npublish_blobs=${quote(context.publishHost.blobRoot)}`;
}

// A whole-line placeholder the template keeps so a non-game daemon renders the original text byte for byte.
// A following blank line is consumed with it, so removing a section leaves one blank line, not two.
function withoutLine(text: string, placeholder: string): string {
  return text.replace(new RegExp(`^[ \\t]*${placeholder}\\n(?:\\n)?`, 'mu'), '');
}

function replaceLine(text: string, placeholder: string, replacement: string): string {
  return text.replace(new RegExp(`^([ \\t]*)${placeholder}$`, 'mu'), (_, indent: string) =>
    replacement
      .split('\n')
      .map((line) => `${indent}${line}`)
      .join('\n'),
  );
}
