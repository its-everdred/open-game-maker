import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { normalize, sep } from 'node:path';

import { PolicyViolation, RenderInputSchema, type RenderInput } from './types.js';

export const DEFAULT_DENY_READ_ROOTS = [
  '~/.config/gh',
  '~/.aiur/github-budget',
  '~/.codex/auth.json',
  '~/.claude',
  '~/.claude-2',
  '~/.config/ogm',
  '~/.config/netlify',
  '~/.ssh',
  '~/.aws',
  '~/.npmrc',
  '~/.git-credentials',
  '~/.aiur/.env',
  '~/.aiur/accounts',
  '~/.aiur/repo',
  '~/.aiur/w',
  '~/.aiur/workspaces',
  '~/.cache/ogm/assets',
] as const;

const profileTemplate = readFileSync(new URL('../../sandbox/profile.toml', import.meta.url), 'utf8');

export function renderCodexProfile(rawInput: RenderInput): string {
  const input = RenderInputSchema.parse(rawInput);
  const workspaceRoot = normalize(input.workspaceRoot);
  const denyRoots = [...new Set([...DEFAULT_DENY_READ_ROOTS, ...input.denyReadRoots].map(expandHome))]
    .filter((path) => keepDenyRoot(path, workspaceRoot))
    .sort();

  const rules = denyRoots.map((path) => `${JSON.stringify(path)} = "deny"`).join('\n');
  return profileTemplate.replace('{{DENY_RULES}}', rules);
}

export function profileHash(profile: string): string {
  return createHash('sha256').update(profile).digest('hex');
}

function expandHome(path: string): string {
  return path.startsWith('~/') ? `${homedir()}${sep}${path.slice(2)}` : normalize(path);
}

function keepDenyRoot(pattern: string, workspaceRoot: string): boolean {
  if (pattern.includes('*')) {
    if (globToRegExp(pattern).test(workspaceRoot)) {
      throw new PolicyViolation('denyReadRoots globs must not match workspaceRoot; enumerate other workspaces');
    }
    return true;
  }

  const normalizedPattern = normalize(pattern);
  return !(
    normalizedPattern === workspaceRoot ||
    workspaceRoot.startsWith(`${normalizedPattern}${sep}`) ||
    normalizedPattern.startsWith(`${workspaceRoot}${sep}`)
  );
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${source}$`);
}
