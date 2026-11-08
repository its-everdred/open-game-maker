import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { GameRepoTemplateSource, renderRepoTemplate, type TemplateCtx } from '../src/index.js';
import fixture from './fixtures/repo-files.json' with { type: 'json' };

const ctx: TemplateCtx = { gameId: 'g_01J', owner: 'everdred-games', visibility: 'private' };
// A root with no `skills/` or `templates/`: the placeholder pack and scaffold, as on main before OGM-091/023.
const emptyRoot = () => mkdtempSync(join(tmpdir(), 'ogm-template-root-'));

function summary(files: ReturnType<typeof renderRepoTemplate>['files']) {
  return files.map((f) => ({
    path: f.path,
    mode: f.mode ?? '100644',
    ...(f.mode === '120000' ? { target: f.content } : {}),
  }));
}

describe('renderRepoTemplate', () => {
  it('renders exactly the fixture file set for game-3d@1', () => {
    expect(summary(renderRepoTemplate('game-3d@1', ctx, emptyRoot()).files)).toEqual(fixture);
  });

  it('links every Codex and .agents skill relatively to a rendered .claude/skills directory', () => {
    const { files } = renderRepoTemplate('game-3d@1', ctx, emptyRoot());
    const links = files.filter((f) => f.mode === '120000');
    expect(links.map((f) => f.path).sort()).toEqual(['.agents/skills/gm-core', '.codex/skills/gm-core']);
    for (const link of links) {
      expect(link.content.startsWith('/')).toBe(false);
      const resolved = join(link.path, '..', link.content);
      expect(resolved).toMatch(/^\.claude\/skills\/gm-[a-z-]+$/);
      expect(files.some((f) => f.path.startsWith(`${resolved}/`) && f.mode !== '120000')).toBe(true);
    }
  });

  it('records the pack version in skills.lock and uses the workspace pack when OGM-091 ships one', () => {
    const placeholder = renderRepoTemplate('game-2d@1', ctx, emptyRoot()).files.find((f) => f.path === 'skills.lock');
    expect(JSON.parse(placeholder!.content)).toEqual({ pack: '0.0.0-placeholder', vendored: {} });

    const root = emptyRoot();
    mkdirSync(join(root, 'skills/gm-core'), { recursive: true });
    mkdirSync(join(root, 'skills/gm-repair'), { recursive: true });
    writeFileSync(join(root, 'skills/gm-core/SKILL.md'), 'real core\n');
    writeFileSync(join(root, 'skills/gm-repair/SKILL.md'), 'real repair\n');
    writeFileSync(join(root, 'skills/skills.lock'), '{ "pack": "1.0.0", "vendored": {} }\n');
    const { files } = renderRepoTemplate('game-2d@1', ctx, root);
    expect(JSON.parse(files.find((f) => f.path === 'skills.lock')!.content).pack).toBe('1.0.0');
    expect(files.find((f) => f.path === '.claude/skills/gm-core/SKILL.md')!.content).toBe('real core\n');
    expect(files.find((f) => f.path === '.codex/skills/gm-repair')).toMatchObject({ mode: '120000' });
  });

  it('renders the real workspace skill pack with a complete matching lock', () => {
    const { files } = renderRepoTemplate('game-2d@1', ctx);
    const lock = JSON.parse(files.find((file) => file.path === 'skills.lock')!.content) as {
      v: number;
      pack: string;
      installedAt: string;
      skills: Record<string, { sha256: string }>;
      vendored: Record<string, string>;
    };

    expect(lock).toMatchObject({ v: 1, pack: '0.0.0', installedAt: '' });
    expect(Object.keys(lock.skills)).toEqual(expect.arrayContaining(['gm-core/SKILL.md', 'gm-build/SKILL.md']));
    expect(Object.keys(lock.vendored).length).toBeGreaterThan(0);
    for (const [path, entry] of Object.entries(lock.skills)) {
      const content = files.find((file) => file.path === `.claude/skills/${path}`)?.content;
      expect(content, path).toBeTypeOf('string');
      expect(createHash('sha256').update(content!).digest('hex'), path).toBe(entry.sha256);
    }
    expect(files.find((file) => file.path === '.codex/skills/gm-core')).toMatchObject({
      content: '../../.claude/skills/gm-core',
      mode: '120000',
    });
  });

  it('lists vendored skills flat in .claude/skills so a top-level skill index finds them', () => {
    const { files } = renderRepoTemplate('game-3d@1', ctx);
    const link = files.find((file) => file.path === '.claude/skills/threejs-lighting');
    expect(link).toMatchObject({ content: 'vendor/threejs/threejs-lighting', mode: '120000' });
    expect(files.some((file) => file.path === '.claude/skills/vendor/threejs/threejs-lighting/SKILL.md')).toBe(true);
    expect(files.find((file) => file.path === '.claude/skills/gm-core')).toBeUndefined();
  });

  it('names the ci job `required` and runs the commands AGENTS.md names', () => {
    const { files, requiredChecks } = renderRepoTemplate('game-3d@1', ctx, emptyRoot());
    const workflow = parse(files.find((f) => f.path === '.github/workflows/ci.yml')!.content);
    expect(workflow.name).toBe('ci');
    expect(Object.keys(workflow.jobs)).toEqual(['required']);
    expect(workflow.jobs.required.name).toBe('required');
    expect(workflow.env.GM_VERIFY_SOFTWARE_GL).toBe('1');
    const runs = workflow.jobs.required.steps.flatMap((step: { run?: string }) => (step.run ? [step.run] : []));
    expect(runs).toEqual(expect.arrayContaining(['pnpm install --frozen-lockfile', 'pnpm run check', 'pnpm run test']));
    const agents = files.find((f) => f.path === 'AGENTS.md')!.content;
    for (const command of ['pnpm install --frozen-lockfile', 'pnpm run check', 'pnpm run test']) {
      expect(agents).toContain(`\`${command}\``);
    }
    expect(agents).toContain('gm-core');
    expect(agents).toContain('## Local tests');
    expect(requiredChecks).toEqual(['ci / required', 'ogm/boundary']);
  });

  it('ignores the job bundle and build output', () => {
    const gitignore = renderRepoTemplate('game-3d@1', ctx, emptyRoot()).files.find((f) => f.path === '.gitignore')!;
    expect(gitignore.content.split('\n')).toEqual(expect.arrayContaining(['node_modules/', '.gm/', 'dist/']));
  });

  it('keeps the owner out of a public repo', () => {
    const { files } = renderRepoTemplate('game-3d@1', { ...ctx, visibility: 'public' }, emptyRoot());
    for (const file of files) expect(file.content).not.toContain('everdred-games');
  });

  it('is deterministic for a given ref and context', () => {
    const root = emptyRoot();
    expect(renderRepoTemplate('game-3d@1', ctx, root)).toEqual(renderRepoTemplate('game-3d@1', ctx, root));
  });

  it("uses the engine's workspace scaffold when it exists, keeping executable bits", () => {
    const root = emptyRoot();
    mkdirSync(join(root, 'templates/game-multiplayer/src'), { recursive: true });
    writeFileSync(join(root, 'templates/game-multiplayer/package.json'), '{"name":"scaffold"}\n');
    writeFileSync(join(root, 'templates/game-multiplayer/README.md'), 'multiplayer scaffold\n');
    writeFileSync(join(root, 'templates/game-multiplayer/src/run.sh'), '#!/bin/sh\n');
    chmodSync(join(root, 'templates/game-multiplayer/src/run.sh'), 0o755);
    const { files } = renderRepoTemplate('game-multiplayer@1', ctx, root);
    expect(files.find((f) => f.path === 'package.json')!.content).toBe('{"name":"scaffold"}\n');
    expect(files.filter((f) => f.path === 'README.md')).toEqual([
      expect.objectContaining({ content: 'multiplayer scaffold\n' }),
    ]);
    expect(files.find((f) => f.path === 'src/run.sh')).toMatchObject({ mode: '100755' });
    expect(files.filter((f) => f.path === 'README.md')).toHaveLength(1);
    expect(files.find((f) => f.path === 'README.md')!.content).not.toBe('scaffold readme\n');
    expect(files.some((f) => f.path === 'pnpm-lock.yaml')).toBe(false);
  });

  it('refuses unknown template refs', async () => {
    expect(() => renderRepoTemplate('default', ctx)).toThrow(/unknown template ref/);
    await expect(new GameRepoTemplateSource(emptyRoot()).render('game-4d@1', ctx)).rejects.toThrow();
  });

  it('labels with every aiur state, reason and marker label', () => {
    const names = renderRepoTemplate('game-3d@1', ctx, emptyRoot()).labels.map((l) => l.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'agent:todo',
        'agent:human-review',
        'agent:ci-red',
        'agent:watch',
        'agent:paused',
        'complexity:5',
        'flake',
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});
