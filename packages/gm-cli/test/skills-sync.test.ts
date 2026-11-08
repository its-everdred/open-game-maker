import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { syncSkillPack } from '../src/skills/pack.js';
import { gm, tempDir } from './helpers.js';

type SkillsLock = {
  v: 1;
  pack: string;
  installedAt: string;
  skills: Record<string, { sha256: string }>;
  vendored: Record<string, string>;
  linkMode?: 'symlink' | 'copy';
};

function write(root: string, path: string, body: string): void {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, body);
}

function makePack(): string {
  const root = tempDir('gm-pack-');
  write(root, 'gm-core/SKILL.md', '---\nname: gm-core\n---\ncore v1\n');
  write(root, 'gm-core/references/rules.md', 'rules v1\n');
  write(root, 'gm-build/SKILL.md', '---\nname: gm-build\n---\nbuild v1\n');
  write(root, 'gm-set-smallscaleint/SKILL.md', '---\nname: gm-set-smallscaleint\n---\nset v1\n');
  write(root, 'gm-set-kaykit/SKILL.md', '---\nname: gm-set-kaykit\n---\nset v1\n');
  write(root, 'gm-core/package.json', '{"private":true}\n');
  write(root, 'gm-core/references/example.test.ts', 'throw new Error("test-only")\n');
  write(root, 'gm-core/dist/example.js', 'throw new Error("build-only")\n');
  write(root, 'vendor/phaser/cameras/SKILL.md', '---\nname: cameras\n---\ncameras v1\n');
  write(
    root,
    'vendor/skills.lock',
    `${JSON.stringify({
      v: 1,
      sets: { 'phaserjs/phaser': { sha: 'abc123', license: 'MIT', path: 'phaser' } },
    })}\n`,
  );
  return root;
}

function lstatExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function sha(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

describe('gm skills sync', () => {
  it('installs runtime pack files, relative discovery links, and vendored pins', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    const result = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    expect(result.code).toBe(0);
    expect(result.out).toContain('installed gm-core');
    expect(readlinkSync(join(repo, '.codex/skills/gm-core'))).toBe('../../.claude/skills/gm-core');
    expect(readlinkSync(join(repo, '.agents/skills/gm-core'))).toBe('../../.claude/skills/gm-core');
    expect(readlinkSync(join(repo, '.codex/skills/cameras'))).toBe('../../.claude/skills/vendor/phaser/cameras');
    expect(statSync(join(repo, '.codex/skills/cameras/SKILL.md')).isFile()).toBe(true);
    expect(existsSync(join(repo, '.claude/skills/gm-core/package.json'))).toBe(false);
    expect(existsSync(join(repo, '.claude/skills/gm-core/references/example.test.ts'))).toBe(false);
    expect(existsSync(join(repo, '.claude/skills/gm-core/dist/example.js'))).toBe(false);
    expect(existsSync(join(repo, '.claude/skills/gm-set-smallscaleint'))).toBe(false);
    expect(existsSync(join(repo, '.claude/skills/gm-set-kaykit'))).toBe(false);

    const lock = JSON.parse(readFileSync(join(repo, 'skills.lock'), 'utf8')) as SkillsLock;
    expect(lock).toMatchObject({ v: 1, pack: '0.0.0', vendored: { 'phaserjs/phaser': 'abc123' } });
    expect(lock.skills['gm-core/SKILL.md']?.sha256).toBe(sha(join(repo, '.claude/skills/gm-core/SKILL.md')));
    expect(lock.skills['gm-core/references/rules.md']?.sha256).toBe(
      sha(join(repo, '.claude/skills/gm-core/references/rules.md')),
    );
    expect(lock.skills['vendor/phaser/cameras/SKILL.md']?.sha256).toBe(
      sha(join(repo, '.claude/skills/vendor/phaser/cameras/SKILL.md')),
    );
  });

  it('links vendored skills flat in .claude/skills and keeps the link across a pack update', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    expect(readlinkSync(join(repo, '.claude/skills/cameras'))).toBe('vendor/phaser/cameras');
    expect(readFileSync(join(repo, '.claude/skills/cameras/SKILL.md'), 'utf8')).toContain('cameras v1');
    expect(lstatSync(join(repo, '.claude/skills/gm-core')).isSymbolicLink()).toBe(false);

    writeFileSync(join(pack, 'vendor/phaser/cameras/SKILL.md'), '---\nname: cameras\n---\ncameras v2\n');
    const updated = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    expect(updated.code).toBe(0);
    expect(readlinkSync(join(repo, '.claude/skills/cameras'))).toBe('vendor/phaser/cameras');
    expect(readFileSync(join(repo, '.claude/skills/cameras/SKILL.md'), 'utf8')).toContain('cameras v2');
    expect(await gm(['skills', 'sync', '--check'], { cwd: repo, env: { GM_SKILLS_DIR: pack } })).toEqual({
      code: 0,
      out: ['skills up to date'],
      err: [],
    });
  });

  it('retargets the links of a vendored skill that moved sets and removes them when it leaves the pack', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    write(pack, 'vendor/gamedev/cameras/SKILL.md', '---\nname: cameras\n---\ncameras moved\n');
    rmSync(join(pack, 'vendor/phaser'), { recursive: true });
    const moved = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    expect(moved.out.filter((line) => line.startsWith('kept local edit'))).toEqual([]);
    expect(readlinkSync(join(repo, '.claude/skills/cameras'))).toBe('vendor/gamedev/cameras');
    expect(readlinkSync(join(repo, '.codex/skills/cameras'))).toBe('../../.claude/skills/vendor/gamedev/cameras');
    expect(readFileSync(join(repo, '.agents/skills/cameras/SKILL.md'), 'utf8')).toContain('cameras moved');

    rmSync(join(pack, 'vendor/gamedev'), { recursive: true });
    await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    expect(lstatExists(join(repo, '.claude/skills/cameras'))).toBe(false);
    expect(statSync(join(repo, '.claude/skills/gm-core/SKILL.md')).isFile()).toBe(true);
    expect(await gm(['skills', 'sync', '--check'], { cwd: repo, env: { GM_SKILLS_DIR: pack } })).toMatchObject({
      code: 0,
    });
  });

  it('keeps the set skill recorded by gm new in step without installing other sets', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    writeFileSync(join(repo, 'gm.lock.json'), '{"v":1,"set":"smallscaleint"}\n');

    const first = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    expect(first).toMatchObject({ code: 0, err: [] });
    expect(statSync(join(repo, '.claude/skills/gm-set-smallscaleint/SKILL.md')).isFile()).toBe(true);
    expect(existsSync(join(repo, '.claude/skills/gm-set-kaykit'))).toBe(false);
    writeFileSync(join(pack, 'gm-set-smallscaleint/SKILL.md'), 'set v2\n');
    const second = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    expect(second.out).toContain('updated gm-set-smallscaleint');
    expect(readFileSync(join(repo, '.claude/skills/gm-set-smallscaleint/SKILL.md'), 'utf8')).toBe('set v2\n');
  });

  it('rejects malformed and unavailable set locks', async () => {
    const pack = makePack();
    const cases = [
      ['not JSON\n', 'gm.lock.json is not valid JSON'],
      ['{"v":1,"set":"../escape"}\n', 'gm.lock.json has an invalid set'],
      ['{"v":1,"set":"synty-simple"}\n', 'style set "synty-simple" has no installed skill'],
    ] as const;

    for (const [lock, message] of cases) {
      const repo = tempDir('gm-game-');
      writeFileSync(join(repo, 'gm.lock.json'), lock);

      const result = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

      expect(result.code).toBe(2);
      expect(result.err[0]).toContain(message);
      expect(existsSync(join(repo, '.claude/skills'))).toBe(false);
    }
  });

  it('is a true no-op when the installed tree and links match the lock', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    const lock = join(repo, 'skills.lock');
    const before = statSync(lock).mtimeMs;

    const result = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    expect(result).toEqual({ code: 0, out: ['skills up to date'], err: [] });
    expect(statSync(lock).mtimeMs).toBe(before);
  });

  it('records installation time for a deterministic scaffold lock', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    const lockFile = join(repo, 'skills.lock');
    const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as SkillsLock;
    writeFileSync(lockFile, `${JSON.stringify({ ...lock, installedAt: '' }, null, 2)}\n`);
    const installed = join(repo, '.claude/skills/gm-core/SKILL.md');
    const installedBefore = statSync(installed).mtimeMs;

    const check = await gm(['skills', 'sync', '--check'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    expect(check).toMatchObject({ code: 1, out: ['lock installation pending'] });
    const result = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    expect(result).toMatchObject({ code: 0, out: ['recorded skill installation'] });
    expect(JSON.parse(readFileSync(lockFile, 'utf8')).installedAt).not.toBe('');
    expect(statSync(installed).mtimeMs).toBe(installedBefore);
  });

  it('keeps local edits, reports drift, and never deletes an unowned file', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    const installed = join(repo, '.claude/skills/gm-core/SKILL.md');
    const extra = join(repo, '.claude/skills/gm-core/my-notes.md');
    writeFileSync(installed, 'local edit\n');
    writeFileSync(extra, 'keep me\n');
    writeFileSync(join(pack, 'gm-core/SKILL.md'), 'upstream v2\n');

    const check = await gm(['skills', 'sync', '--check'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    expect(check.code).toBe(1);
    expect(check.out.join('\n')).toContain('local edit gm-core/SKILL.md');

    const sync = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    expect(sync.code).toBe(0);
    expect(sync.out.join('\n')).toContain('kept local edit gm-core/SKILL.md');
    expect(readFileSync(installed, 'utf8')).toBe('local edit\n');
    expect(readFileSync(extra, 'utf8')).toBe('keep me\n');
    expect((await gm(['skills', 'sync', '--check'], { cwd: repo, env: { GM_SKILLS_DIR: pack } })).code).toBe(1);
  });

  it('adds a newly shipped gm skill and lists installed discovery names', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    write(pack, 'gm-extra/SKILL.md', '---\nname: gm-extra\n---\nextra\n');

    expect((await gm(['skills', 'sync', '--check'], { cwd: repo, env: { GM_SKILLS_DIR: pack } })).code).toBe(1);
    const sync = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    expect(sync.out).toContain('installed gm-extra');
    expect(statSync(join(repo, '.codex/skills/gm-extra/SKILL.md')).isFile()).toBe(true);

    const list = await gm(['skills', 'list', '--limit', '3'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    expect(list.code).toBe(0);
    expect(list.out).toContain('gm-core  0.0.0');
    expect(list.out).toContain('cameras  vendored');
    expect(list.out).not.toContain('gm-extra  0.0.0');
    expect(list.out.at(-1)).toBe('+1 more  (--limit 4)');
  });

  it('falls back to copies when symlinks are unavailable', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    const unavailable = (): never => {
      throw Object.assign(new Error('links unavailable'), { code: 'EPERM' });
    };

    const result = syncSkillPack({ repoDir: repo, packDir: pack, createLink: unavailable });

    expect(result.changed).toBe(true);
    expect(lstatSync(join(repo, '.codex/skills/gm-core')).isSymbolicLink()).toBe(false);
    expect(statSync(join(repo, '.codex/skills/gm-core/SKILL.md')).isFile()).toBe(true);
    expect(readFileSync(join(repo, '.codex/skills/gm-core/.gm-pack-copy'), 'utf8')).toBe('gm-core\n');
    const lock = JSON.parse(readFileSync(join(repo, 'skills.lock'), 'utf8')) as SkillsLock;
    expect(lock.linkMode).toBe('copy');

    const before = statSync(join(repo, 'skills.lock')).mtimeMs;
    const again = syncSkillPack({ repoDir: repo, packDir: pack, createLink: unavailable });
    expect(again.changed).toBe(false);
    expect(statSync(join(repo, 'skills.lock')).mtimeMs).toBe(before);

    write(repo, '.codex/skills/gm-build/notes.md', 'keep me\n');
    rmSync(join(pack, 'gm-build'), { recursive: true });
    syncSkillPack({ repoDir: repo, packDir: pack, createLink: unavailable });
    expect(existsSync(join(repo, '.codex/skills/gm-build/SKILL.md'))).toBe(false);
    expect(readFileSync(join(repo, '.codex/skills/gm-build/notes.md'), 'utf8')).toBe('keep me\n');
  });

  it('forces edited copy mirrors back to the committed pack', () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    const unavailable = (): never => {
      throw Object.assign(new Error('links unavailable'), { code: 'EPERM' });
    };
    syncSkillPack({ repoDir: repo, packDir: pack, createLink: unavailable });
    const mirror = join(repo, '.codex/skills/gm-core/SKILL.md');
    writeFileSync(mirror, 'local mirror edit\n');

    const result = syncSkillPack({ repoDir: repo, packDir: pack, createLink: unavailable, force: true });

    expect(result.changed).toBe(true);
    expect(readFileSync(mirror, 'utf8')).toBe(readFileSync(join(pack, 'gm-core/SKILL.md'), 'utf8'));
    expect(syncSkillPack({ repoDir: repo, packDir: pack, createLink: unavailable, checkOnly: true }).drift).toBe(false);
  });

  it('never claims an unowned copy-fallback discovery collision', () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    const unavailable = (): never => {
      throw Object.assign(new Error('links unavailable'), { code: 'EPERM' });
    };
    syncSkillPack({ repoDir: repo, packDir: pack, createLink: unavailable });
    for (const parent of ['.codex', '.agents']) write(repo, `${parent}/skills/gm-extra/SKILL.md`, 'local\n');
    write(pack, 'gm-extra/SKILL.md', 'upstream\n');

    for (const force of [false, true]) {
      const result = syncSkillPack({ repoDir: repo, packDir: pack, createLink: unavailable, force });
      expect(result.drift).toBe(true);
      for (const parent of ['.codex', '.agents']) {
        expect(readFileSync(join(repo, parent, 'skills/gm-extra/SKILL.md'), 'utf8')).toBe('local\n');
        expect(existsSync(join(repo, parent, 'skills/gm-extra/.gm-pack-copy'))).toBe(false);
      }
    }
    expect(readFileSync(join(repo, '.claude/skills/gm-extra/SKILL.md'), 'utf8')).toBe('upstream\n');
  });

  it('removes obsolete owned discovery links but preserves unowned skills', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    write(repo, '.codex/skills/my-local/SKILL.md', 'local\n');
    rmSync(join(pack, 'gm-build'), { recursive: true });

    await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    expect(existsSync(join(repo, '.codex/skills/gm-build'))).toBe(false);
    expect(existsSync(join(repo, '.agents/skills/gm-build'))).toBe(false);
    expect(readFileSync(join(repo, '.codex/skills/my-local/SKILL.md'), 'utf8')).toBe('local\n');
  });

  it('refuses traversal paths in skills.lock without touching their target', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    const sentinel = join(repo, 'keep.txt');
    writeFileSync(sentinel, 'keep me\n');
    writeFileSync(
      join(repo, 'skills.lock'),
      `${JSON.stringify({
        v: 1,
        pack: '0.0.0',
        installedAt: new Date().toISOString(),
        skills: { '../../keep.txt': { sha256: sha(sentinel) } },
        vendored: {},
      })}\n`,
    );

    const result = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });

    expect(result.code).toBe(2);
    expect(result.err).toEqual(['skills.lock is not valid. Try: restore it or remove it before gm skills sync']);
    expect(readFileSync(sentinel, 'utf8')).toBe('keep me\n');
  });

  it('never follows a managed parent symlink during refresh', async () => {
    const pack = makePack();
    const repo = tempDir('gm-game-');
    const outside = tempDir('gm-outside-');
    await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    const canonical = join(repo, '.claude/skills/gm-core');
    write(outside, 'SKILL.md', readFileSync(join(canonical, 'SKILL.md'), 'utf8'));
    rmSync(canonical, { recursive: true });
    symlinkSync(outside, canonical, 'dir');
    writeFileSync(join(pack, 'gm-core/SKILL.md'), 'upstream v2\n');

    const kept = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    expect(kept.out).toContain('kept local edit gm-core/SKILL.md');
    expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).not.toBe('upstream v2\n');

    await gm(['skills', 'sync', '--force'], { cwd: repo, env: { GM_SKILLS_DIR: pack } });
    expect(lstatSync(canonical).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(canonical, 'SKILL.md'), 'utf8')).toBe('upstream v2\n');
    expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).not.toBe('upstream v2\n');
  });

  it('does not create a lock when no pack can be located', async () => {
    const repo = tempDir('gm-game-');
    const result = await gm(['skills', 'sync'], { cwd: repo, env: { GM_SKILLS_DIR: join(repo, 'missing') } });
    expect(result.code).toBe(2);
    expect(existsSync(join(repo, 'skills.lock'))).toBe(false);
  });
});
