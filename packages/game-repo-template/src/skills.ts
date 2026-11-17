import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isExecutable, listFiles, TEMPLATES, WORKSPACE_ROOT } from './files.js';

export type SkillPack = {
  version: string;
  lock: string;
  // Paths relative to `.claude/skills/`, e.g. `gm-core/SKILL.md`.
  files: { path: string; content: string; mode?: '100755' }[];
  discovery: { name: string; target: string }[];
};

// The `gm-*` pack from `<root>/skills` (OGM-091) when it exists, else the placeholder shipped in this package.
export function skillPack(root: string = WORKSPACE_ROOT): SkillPack {
  const real = join(root, 'skills');
  if (hasPack(real)) return workspaceSkillPack(root, real);
  const source = join(TEMPLATES, 'skills');
  const lock = readFileSync(join(source, 'skills.lock'), 'utf8');
  const parsed = JSON.parse(lock) as { pack?: unknown };
  if (typeof parsed.pack !== 'string' || parsed.pack === '')
    throw new Error(`${source}/skills.lock has no pack version`);
  const files = skillNames(source).flatMap((name) =>
    listFiles(join(source, name)).map((path) => ({
      path: `${name}/${path}`,
      content: readFileSync(join(source, name, path), 'utf8'),
    })),
  );
  return { version: parsed.pack, lock, files, discovery: discoverySkills(files) };
}

export function skillNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('gm-'))
    .map((entry) => entry.name)
    .sort();
}

function hasPack(dir: string): boolean {
  return existsSync(dir) && skillNames(dir).length > 0;
}

function workspaceSkillPack(root: string, dir: string): SkillPack {
  const roots = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (entry.name.startsWith('gm-') || entry.name === 'vendor'))
    .map((entry) => entry.name)
    .sort();
  const files = roots.flatMap((name) =>
    listFiles(join(dir, name)).map((path) => {
      const content = readFileSync(join(dir, name, path), 'utf8');
      return {
        path: `${name}/${path}`,
        content,
        ...(isExecutable(join(dir, name, path)) ? { mode: '100755' as const } : {}),
      };
    }),
  );
  const version = packVersion(root, dir);
  const lock = `${JSON.stringify(
    {
      v: 1,
      pack: version,
      installedAt: '',
      skills: Object.fromEntries(
        files.map(({ path, content }) => [path, { sha256: createHash('sha256').update(content).digest('hex') }]),
      ),
      vendored: vendorPins(dir),
    },
    null,
    2,
  )}\n`;
  return { version, lock, files, discovery: discoverySkills(files) };
}

function packVersion(root: string, dir: string): string {
  const packageFile = join(root, 'packages/gm-cli/package.json');
  const lockFile = join(dir, 'skills.lock');
  const parsed = JSON.parse(readFileSync(existsSync(packageFile) ? packageFile : lockFile, 'utf8')) as {
    version?: unknown;
    pack?: unknown;
  };
  const version = existsSync(packageFile) ? parsed.version : parsed.pack;
  if (typeof version !== 'string' || version === '') throw new Error('workspace skill pack has no version');
  return version;
}

function vendorPins(dir: string): Record<string, string> {
  const file = join(dir, 'vendor/skills.lock');
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { sets?: Record<string, { sha?: unknown }> };
  return Object.fromEntries(
    Object.entries(parsed.sets ?? {}).flatMap(([name, entry]) =>
      typeof entry.sha === 'string' ? [[name, entry.sha] as const] : [],
    ),
  );
}

function discoverySkills(files: SkillPack['files']): SkillPack['discovery'] {
  const skills: SkillPack['discovery'] = [];
  for (const { path } of files.filter(({ path }) => path.endsWith('/SKILL.md'))) {
    const target = path.slice(0, -'/SKILL.md'.length);
    const name = target.startsWith('vendor/') ? target.split('/').at(-1) : target;
    if (!name) continue;
    if (skills.some((skill) => skill.name === name)) throw new Error(`skill discovery name is not unique: ${name}`);
    skills.push({ name, target });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
