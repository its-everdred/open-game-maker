import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const vendor = join(dirname(fileURLToPath(import.meta.url)), '../../skills/vendor');
const SETS = {
  phaser: 'MIT',
  threejs: 'MIT',
  gamedev: 'Apache-2.0',
  'sprite-forge': 'MIT',
  'video-to-game': 'MIT',
  'frontend-design': 'Apache-2.0',
} as const;
/** Tool sets ship the scripts their gm wrappers run; the engine sets stay text only. */
const TOOL_SETS = ['sprite-forge', 'video-to-game'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const all = walk(vendor);
const rel = (file: string) => relative(vendor, file);
/** The vendored skill files: every markdown file inside a skill directory. */
const skillFiles = all.filter((f) => f.endsWith('.md') && rel(f).split('/').length > 2);
const read = (path: string) => readFileSync(join(vendor, path), 'utf8');

function frontMatter(file: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, 'utf8'));
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => /^(\w+):\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
}

interface Lock {
  sets: Record<string, { sha: string; license: string; path: keyof typeof SETS }>;
}
const lock = JSON.parse(read('skills.lock')) as Lock;

describe('vendored skill sets', () => {
  it('holds the expected skills per set', () => {
    const count = (set: string) =>
      skillFiles.filter((f) => rel(f).startsWith(`${set}/`) && f.endsWith('/SKILL.md')).length;
    expect(Object.keys(SETS).map(count)).toEqual([28, 11, 17, 5, 0, 1]);
    expect(existsSync(join(vendor, 'threejs/threejs-react-three-fiber'))).toBe(false);
  });

  it('gives every file its licence, its pinned source and whether it was modified', () => {
    for (const file of skillFiles) {
      const set = rel(file).split('/')[0] as keyof typeof SETS;
      const meta = frontMatter(file);
      const pin = Object.entries(lock.sets).find(([, s]) => s.path === set);
      expect(meta.license, rel(file)).toBe(SETS[set]);
      expect(meta.source, rel(file)).toMatch(new RegExp(`^${pin?.[0]}@${pin?.[1].sha} \\S+\\.md$`));
      expect(['true', 'false'], rel(file)).toContain(meta.modified);
      if (set === 'gamedev') expect(meta.modified, rel(file)).toBe('true');
    }
  });

  it('lists every modified file in its set CHANGES.md', () => {
    for (const set of Object.keys(SETS)) {
      const changes = read(`${set}/CHANGES.md`);
      for (const file of skillFiles.filter((f) => rel(f).startsWith(`${set}/`) && frontMatter(f).modified === 'true')) {
        expect(changes, rel(file)).toContain(`- ${relative(join(vendor, set), file)}:`);
      }
    }
  });

  it('keeps each upstream licence and notice', () => {
    expect(read('phaser/LICENSE.md')).toContain('Copyright (c) 2026 Richard Davey, Phaser Studio Inc.');
    expect(read('threejs/LICENSE')).toContain('Copyright (c) 2026 CloudAI-X');
    expect(read('gamedev/LICENSE')).toContain('Apache License');
    expect(read('gamedev/NOTICE')).toContain('Copyright 2026 Abhishek Barali');
    expect(read('sprite-forge/LICENSE')).toContain('Copyright (c) 2026 0x0funky');
    expect(read('video-to-game/LICENSE')).toContain('Copyright (c) 2026 Lovis Odin');
    expect(read('frontend-design/LICENSE.txt')).toContain('Apache License');
  });

  it('pins each set to a full commit in skills.lock', () => {
    expect(Object.keys(lock.sets).sort()).toEqual([
      '0x0funky/agent-sprite-forge',
      'CloudAI-X/threejs-skills',
      'anthropics/claude-plugins-official',
      'gamedev-skills/awesome-gamedev-agent-skills',
      'lovisdotio/video-to-game',
      'phaserjs/phaser',
    ]);
    for (const set of Object.values(lock.sets)) {
      expect(set.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(set.license).toBe(SETS[set.path]);
      expect(statSync(join(vendor, set.path)).isDirectory()).toBe(true);
    }
  });
});

describe('vendored text runs nothing', () => {
  it('holds no scripts outside the tool sets and no executables anywhere', () => {
    const inToolSet = (f: string) => TOOL_SETS.includes(rel(f).split('/')[0]);
    const runnable = all.filter((f) => !inToolSet(f) && /\.(sh|py|js|mjs|cjs|ts)$/.test(f));
    expect(runnable.map(rel)).toEqual([]);
    expect(all.filter((f) => (statSync(f).mode & 0o111) !== 0).map(rel)).toEqual([]);
  });

  // Kevin's policy: no fal, no provider keys. Upstream video-to-game generates every asset with fal; only its local
  // study and compare tools may be vendored.
  it('vendors none of the video-to-game fal generation', () => {
    const files = all.filter((f) => rel(f).startsWith('video-to-game/')).map(rel);
    expect(files.filter((f) => /fal|SKILL\.md|record_play|templates\//.test(f))).toEqual([]);
    for (const f of files.filter((f) => f.endsWith('.py')))
      expect(read(f), f).not.toMatch(/\bfal\b|FAL_KEY|https?:\/\//);
  });

  it('fetches nothing from the network in code blocks', () => {
    const hits: string[] = [];
    for (const file of skillFiles) {
      let inCode = false;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          /* An XML namespace (`xmlns="http://www.w3.org/2000/svg"`) is a name, not a fetch. */
          const fetched = line.replace(/xmlns(?::\w+)?="http:\/\/www\.w3\.org\/[^"]*"/g, '');
          if (/^\s*```/.test(line)) inCode = !inCode;
          else if (inCode && /https?:\/\//.test(fetched) && !/\/\/ reference:.*https?:\/\//.test(fetched)) {
            hits.push(`${rel(file)}:${index + 1}`);
          }
          if (/jsdelivr|unpkg/.test(line)) hits.push(`${rel(file)}:${index + 1} cdn`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('has no GDScript, Python or C# left in the gamedev adaptations', () => {
    const fences = skillFiles
      .filter((f) => rel(f).startsWith('gamedev/'))
      .flatMap((f) =>
        (readFileSync(f, 'utf8').match(/^\s*```\s*\w+/gm) ?? []).map((fence) => `${rel(f)} ${fence.trim()}`),
      );
    expect(fences.filter((f) => /```(gdscript|gd|python|py|csharp|cs|c#|js|javascript|html)$/.test(f))).toEqual([]);
  });
});
