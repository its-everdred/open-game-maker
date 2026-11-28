import { writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Create a network-off check profile which hides host credentials and other daemon workspaces. */
export function writePublishSandbox(
  profileDir: string,
  home: string,
  workRoot: string,
  checkout: string,
  assetRoots: string[] = [],
  readRoots: string[] = [],
): void {
  const denied = [
    '.config/gh',
    '.config/ogm',
    '.config/netlify',
    '.ssh',
    '.aws',
    '.npmrc',
    '.git-credentials',
    '.codex',
    '.claude',
    '.claude-2',
    '.aiur/.env',
    '.aiur/accounts',
    '.aiur/github-budget',
    '.aiur/w',
    '.aiur/workspaces',
    '.aiur/repo',
    '.local/share/ogm/daemons',
    '.cache/ogm/assets',
  ].map((part) => join(home, part));
  denied.push(...assetRoots);
  // A nested deny requires bubblewrap to create a mount point inside the
  // already-denied parent. The parent alone also hides this profile.
  const profileFromWorkRoot = relative(workRoot, profileDir);
  if (profileFromWorkRoot === '..' || profileFromWorkRoot.startsWith(`..${sep}`) || isAbsolute(profileFromWorkRoot))
    denied.push(profileDir);
  denied.push(workRoot);
  const rules = [...new Set(denied)].map((path) => `${JSON.stringify(path)} = "deny"`).join('\n');
  writeFileSync(
    join(profileDir, 'config.toml'),
    [
      'default_permissions = "gamebuilder"',
      '[shell_environment_policy]',
      'inherit = "all"',
      '[permissions.gamebuilder]',
      'extends = ":workspace"',
      '[permissions.gamebuilder.filesystem]',
      '":slash_tmp" = "deny"',
      rules,
      `${JSON.stringify(checkout)} = "write"`,
      ...readRoots.map((path) => `${JSON.stringify(path)} = "read"`),
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
}

/** The game process gets only operational values, never the host's credential environment. */
export function publishSandboxEnv(env: Record<string, string | undefined>, profileDir: string): Record<string, string> {
  const allowed = [
    'PATH',
    'HOME',
    'XDG_RUNTIME_DIR',
    'COREPACK_HOME',
    'PNPM_HOME',
    'TMPDIR',
    'CI',
    'NODE_ENV',
    'OGM_ASSETS_ROOT',
    'OGM_BLOB_ROOT',
    'GM_ASSET_CACHE_DIR',
    'GM_VERIFY_SOFTWARE_GL',
    // These harmless paths are used by the publish command's isolated test fixture.
    'PNPM_LOG',
    'BUILD_ARGS_LOG',
    'BUILD_ENV_LOG',
    'ASSET_CACHE_SENTINEL',
  ];
  const result: Record<string, string> = { CODEX_HOME: profileDir, GIT_TERMINAL_PROMPT: '0' };
  for (const name of allowed) if (env[name] !== undefined) result[name] = env[name]!;
  return result;
}
