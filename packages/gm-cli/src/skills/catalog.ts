import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readRoles, ROLES_PATH, type Role } from '@ogm/game-repo-template';

import { locateSkillPack } from './pack.js';

export type SkillEntry = { name: string; description: string; file: string };

const INSTALLED = '.claude/skills';

/** A game repo's installed `.claude/skills` when it has one, else the platform skill pack. */
export function catalogRoot(cwd: string, skillsDir: string | null): string {
  const installed = join(cwd, INSTALLED);
  return existsSync(installed) ? installed : locateSkillPack(cwd, skillsDir);
}

/** The role table from the installed gm-core when present, else from the platform pack. */
export function rolesFor(cwd: string, skillsDir: string | null): Role[] {
  const installed = join(cwd, INSTALLED);
  return readRoles(existsSync(join(installed, ROLES_PATH)) ? installed : locateSkillPack(cwd, skillsDir));
}

function skillFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') return skillFiles(path);
    return entry.isFile() && entry.name === 'SKILL.md' ? [path] : [];
  });
}

// `key: value`, a quoted value, or a folded/literal block (`key: >`) whose indented lines follow.
function frontMatterValue(lines: string[], key: string): string {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index < 0) return '';
  const value = lines[index]!.slice(key.length + 1).trim();
  if (!/^[>|][+-]?$/.test(value)) return value.replace(/^(['"])(.*)\1$/, '$2');
  const block: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (!/^\s+\S/.test(line)) break;
    block.push(line.trim());
  }
  return block.join(' ');
}

export function readCatalog(root: string): SkillEntry[] {
  const entries = skillFiles(root).map((file) => {
    const text = readFileSync(file, 'utf8');
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    const lines = head.split(/\r?\n/);
    const name = frontMatterValue(lines, 'name') || (file.split(/[\\/]/).at(-2) ?? '');
    return { name, description: frontMatterValue(lines, 'description'), file };
  });
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Skills naming any of the words, most hits first; a hit in the name counts twice. */
export function searchCatalog(entries: SkillEntry[], words: string[]): SkillEntry[] {
  const terms = words.map((word) => word.toLowerCase()).filter((word) => word !== '');
  const scored = entries.map((entry) => {
    const name = entry.name.toLowerCase();
    const description = entry.description.toLowerCase();
    const score = terms.reduce(
      (sum, term) => sum + (name.includes(term) ? 2 : 0) + (description.includes(term) ? 1 : 0),
      0,
    );
    return { entry, score };
  });
  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry }) => entry);
}

/** The role labels whose mandatory set includes `skill`. */
export function mandatoryFor(roles: Role[], skill: string): string[] {
  return roles.filter((role) => role.skills.includes(skill)).map((role) => role.label);
}
