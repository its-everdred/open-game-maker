import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
  it('renders a small game without copied skills, even when installed dependencies exist', () => {
    const root = emptyRoot();
    mkdirSync(join(root, 'skills/gm-core/node_modules/.bin'), { recursive: true });
    writeFileSync(join(root, 'skills/gm-core/node_modules/.bin/gm'), 'installed dependency');
    writeFileSync(join(root, 'skills/gm-core/SKILL.md'), 'name: gm-core');
    writeFileSync(join(root, 'skills/skills.lock'), '{\"pack\":\"1.0.0\"}');
    const { files } = renderRepoTemplate('game-2d@1', ctx, root);
    expect(files.some((file) => /^(?:\.claude|\.codex|\.agents)\/skills(?:\/|$)/u.test(file.path))).toBe(false);
    expect(files.some((file) => file.path.includes('node_modules'))).toBe(false);
    expect(files.length).toBeLessThan(50);
    expect(summary(renderRepoTemplate('game-3d@1', ctx, emptyRoot()).files)).toEqual(fixture);
  });

  it('names the ci job `required` and runs the commands AGENTS.md names', () => {
    const { files, requiredChecks } = renderRepoTemplate('game-3d@1', ctx, emptyRoot());
    const workflow = parse(files.find((f) => f.path === '.github/workflows/ci.yml')!.content);
    expect(workflow.name).toBe('ci');
    expect(Object.keys(workflow.jobs)).toEqual(['required']);
    expect(workflow.jobs.required.name).toBe('required');
    expect(
      workflow.jobs.required.steps.find((step: { uses?: string }) => step.uses === 'actions/checkout@v4').with[
        'fetch-depth'
      ],
    ).toBe(0);
    expect(workflow.env.GM_VERIFY_SOFTWARE_GL).toBe('1');
    const runs = workflow.jobs.required.steps.flatMap((step: { run?: string }) => (step.run ? [step.run] : []));
    expect(runs).toEqual(expect.arrayContaining(['pnpm install --frozen-lockfile', 'pnpm run check', 'pnpm run test']));
    const agents = files.find((f) => f.path === 'AGENTS.md')!.content;
    for (const command of ['pnpm install --frozen-lockfile', 'pnpm run check', 'pnpm run test']) {
      expect(agents).toContain(`\`${command}\``);
    }
    expect(agents).toContain('gm-core');
    expect(agents).toContain('gm prefs list');
    expect(agents).toContain('gm prefs check');
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
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['add', '.'], { cwd: root });
    mkdirSync(join(root, 'templates/game-multiplayer/dist'), { recursive: true });
    mkdirSync(join(root, 'templates/game-multiplayer/src/node_modules/pkg'), { recursive: true });
    writeFileSync(join(root, 'templates/game-multiplayer/dist/bundle.js'), 'generated');
    writeFileSync(join(root, 'templates/game-multiplayer/src/node_modules/pkg/index.js'), 'dependency');
    const { files } = renderRepoTemplate('game-multiplayer@1', ctx, root);
    expect(files.some((file) => /(^|\/)(dist|node_modules)\//u.test(file.path))).toBe(false);
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
