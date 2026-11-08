import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WORKSPACE_ROOT } from './files.js';

export type Role = { label: string; skills: string[] };
export type GameSkills = { slug: string; set?: string };
export type SkillsConfig = { preload_max_bytes: number; by_label: Record<string, string[]> };

// `skills/gm-core/references/roles.md`, relative to a skills root (the platform pack or a game's `.claude/skills`).
export const ROLES_PATH = 'gm-core/references/roles.md';

// Large enough that a ticket's whole mandatory set inlines (role:visual + role:3d + a game label is about 29 KB).
export const PRELOAD_MAX_BYTES = 49152;

const ROW = /^\|\s*`(role:[a-z0-9-]+)`\s*\|[^|]*\|([^|]+)\|\s*$/;

/** The role table in roles.md: one `| \`role:x\` | work | skill, skill |` row per role. */
export function parseRoles(markdown: string): Role[] {
  const roles: Role[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = ROW.exec(line.trim());
    if (!match) continue;
    const skills = match[2]!
      .split(',')
      .map((skill) => skill.trim())
      .filter((skill) => skill !== '');
    if (skills.length === 0) throw new Error(`${match[1]} has no mandatory skills`);
    if (roles.some((role) => role.label === match[1])) throw new Error(`${match[1]} is listed twice`);
    roles.push({ label: match[1]!, skills });
  }
  if (roles.length === 0) throw new Error('no role:* rows found');
  return roles;
}

export function readRoles(skillsRoot: string = join(WORKSPACE_ROOT, 'skills')): Role[] {
  return parseRoles(readFileSync(join(skillsRoot, ROLES_PATH), 'utf8'));
}

/** `game:<slug>` carries gm-core plus the game's set skill; a game with no set gets gm-core alone. */
export function gameLabelSkills(game: GameSkills): string[] {
  return game.set ? ['gm-core', `gm-set-${game.set}`] : ['gm-core'];
}

/** aiur's `agent.skills` block: each game label, then each role label, with its mandatory skills. */
export function skillsConfig(roles: Role[], games: GameSkills[] = []): SkillsConfig {
  const byLabel: Record<string, string[]> = {};
  for (const game of [...games].sort((a, b) => a.slug.localeCompare(b.slug)))
    byLabel[`game:${game.slug}`] = gameLabelSkills(game);
  for (const role of roles) byLabel[role.label] = [...role.skills];
  return { preload_max_bytes: PRELOAD_MAX_BYTES, by_label: byLabel };
}
