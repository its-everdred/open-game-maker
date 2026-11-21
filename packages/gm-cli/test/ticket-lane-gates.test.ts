import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

function repo() {
  const cwd = tempDir();
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd });
  git('init', '-q');
  writeFileSync(join(cwd, 'gm.manifest.json'), '{}');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { cwd, git };
}

function spriteRecipe() {
  return {
    schema: 'ogm.sprite-recipe/1', set: 'example-generated', slug: 'rock', version: '1', scene: 'rock', seed: 3,
    parameters: { samples: 1, shape: 1 }, views: 'N', output: 'rock_N.png', output_sha256: 'a'.repeat(64),
    pixel_sha256: 'b'.repeat(64), rig_sha256: 'c'.repeat(64), blender_version: 'Blender 4.3.2',
    derived_from: ['t1:example/rock@1'], agent: { backend: 'codex', model: 'test', effort: 'high' },
    skills: [{ name: 'gm-sprite-forge', version: '1' }], tools: [{ name: 'Blender', version: '4.3.2' }],
    scores: { silhouette: 0.9 }, gate_results: { prop: { pass: true } }, ticket: 1106,
    created_at: '2026-11-20T00:00:00Z', approved_by_creator: true,
    ai_generated: true, verdict_quote: 'Matches', materials: {}, reference_card_ids: ['t1:example/rock@1'], prompt: null,
  };
}

describe('gm check ticket lanes', () => {
  it('blocks game source changes on a creative mock rung', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'games/demo/src'), { recursive: true });
    writeFileSync(join(cwd, 'games/demo/src/main.ts'), 'export {};');
    git('add', '-A');
    git('commit', '-qm', 'change source');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:creative phase:mock');
    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'mock'], { cwd });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('phase:mock may not change game source');
  });

  it('requires approved look decisions before prototype and build work', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src/scene.ts'), 'export {};');
    git('add', '-A');
    git('commit', '-qm', 'change scene');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:creative phase:build');
    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'], { cwd });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('phase:build needs an approved prototype');
  });

  it('requires clone recipe metadata and originals', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'round'), { recursive: true });
    writeFileSync(join(cwd, 'round/recipe.json'), JSON.stringify({ schema: 'bad' }));
    git('add', '-A');
    git('commit', '-qm', 'add clone recipe');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:clone');
    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'clone'], { cwd });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('not a valid sprite-forge recipe');
  });

  it('rejects a valid clone recipe that does not attach original media', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'round'), { recursive: true });
    writeFileSync(join(cwd, 'round/recipe.json'), JSON.stringify(spriteRecipe()));
    git('add', '-A');
    git('commit', '-qm', 'add clone recipe');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:clone');
    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'clone'], { cwd });
    expect(result.err.join('\n')).toContain('has no original media attached under round/originals/');
  });

  it('rejects clone recipes with failing gate results', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'round/originals'), { recursive: true });
    writeFileSync(join(cwd, 'round/originals/source.png'), 'source');
    writeFileSync(join(cwd, 'round/recipe.json'), JSON.stringify({
      ...spriteRecipe(),
      gate_results: { prop: { pass: false } },
    }));
    git('add', '-A');
    git('commit', '-qm', 'add clone recipe and source');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:clone');
    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'clone'], { cwd });
    expect(result.err.join('\n')).toContain('missing or failing gm-sprite-forge gate results');
  });

  it('does not let another game’s decision record approve this game’s build rung', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    mkdirSync(join(cwd, 'docs/other-game'), { recursive: true });
    writeFileSync(join(cwd, 'src/scene.ts'), 'export {};');
    writeFileSync(join(cwd, 'docs/other-game/decisions.json'), JSON.stringify({ screens: { title: { target: 'mock.png' } } }));
    git('add', '-A');
    git('commit', '-qm', 'add unrelated decision');
    writeFileSync(join(cwd, 'pr.md'), 'Prototype review: none');
    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'], { cwd });
    expect(result.err.join('\n')).toContain('phase:build needs an approved prototype');
  });

  it('requires an answered, media-backed decision tied to this ticket', async () => {
    const { cwd } = repo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    mkdirSync(join(cwd, 'docs', basename(cwd)), { recursive: true });
    writeFileSync(join(cwd, 'src/scene.ts'), 'export {};');
    const decision = {
      id: 'approved-mock', area: 'screen', question: 'Choose a mock', why: 'visual direction',
      options: [{ label: 'A', media: 'mock-a.png' }, { label: 'B', media: 'mock-b.png' }],
      recommendation: 'A: clearer', sources: ['image mock'], ticket: 999, status: 'answered', answer: 'A',
      answered_at: '2026-11-20T00:00:00Z',
    };
    writeFileSync(join(cwd, 'docs', basename(cwd), 'decisions.json'), JSON.stringify([decision]));
    writeFileSync(join(cwd, 'pr.md'), 'Refs #1106\nPrototype review: none');
    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'], { cwd });
    expect(result.err.join('\n')).toContain('phase:build needs an approved prototype');
  });

  it('accepts an answered, media-backed decision tied to this ticket', async () => {
    const { cwd } = repo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    mkdirSync(join(cwd, 'docs', basename(cwd)), { recursive: true });
    writeFileSync(join(cwd, 'src/scene.ts'), 'export {};');
    const decision = {
      id: 'approved-mock', area: 'screen', question: 'Choose a mock', why: 'visual direction',
      options: [{ label: 'A', media: 'mock-a.png' }, { label: 'B', media: 'mock-b.png' }],
      recommendation: 'A: clearer', sources: ['image mock'], ticket: 1106, status: 'answered', answer: 'A',
      answered_at: '2026-11-20T00:00:00Z',
    };
    writeFileSync(join(cwd, 'docs', basename(cwd), 'decisions.json'), JSON.stringify([decision]));
    writeFileSync(join(cwd, 'pr.md'), 'Refs #1106\nPrototype review: none');
    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'], { cwd });
    expect(result.err.join('\n')).not.toContain('phase:build needs an approved prototype');
  });

  it('reports an unreadable PR body instead of crashing', async () => {
    const { cwd } = repo();
    const result = await gm(['check', '--body', 'missing.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'mock'], { cwd });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('cannot read PR body missing.md');
  });

  it('rejects an unknown ticket lane', async () => {
    const result = await gm(['check', '--lane', 'gameplay']);
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('invalid ticket lane "gameplay". Try: use --lane creative|clone');
  });
});
