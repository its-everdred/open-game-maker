import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

function repo() {
  const cwd = tempDir();
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd });
  git('init', '-q');
  writeFileSync(join(cwd, 'gm.manifest.json'), '{}');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { cwd, git };
}

function spriteRecipe() {
  return {
    schema: 'ogm.sprite-recipe/1',
    set: 'example-generated',
    slug: 'rock',
    version: '1',
    scene: 'rock',
    seed: 3,
    parameters: { samples: 1, shape: 1 },
    views: 'N',
    output: 'rock_N.png',
    output_sha256: 'a'.repeat(64),
    pixel_sha256: 'b'.repeat(64),
    rig_sha256: 'c'.repeat(64),
    blender_version: 'Blender 4.3.2',
    derived_from: ['t1:example/rock@1'],
    agent: { backend: 'codex', model: 'test', effort: 'high' },
    skills: [{ name: 'gm-sprite-forge', version: '1' }],
    tools: [{ name: 'Blender', version: '4.3.2' }],
    scores: { silhouette: 0.9 },
    gate_results: { prop: { pass: true } },
    ticket: 1106,
    created_at: '2026-11-20T00:00:00Z',
    approved_by_creator: true,
    ai_generated: true,
    verdict_quote: 'Matches',
    materials: {},
    reference_card_ids: ['t1:example/rock@1'],
    prompt: null,
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
    const result = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'mock'],
      { cwd },
    );
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
    const result = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'],
      { cwd },
    );
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('phase:build needs an approved prototype');
  });

  it('requires a prototype-level review target before build work', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    mkdirSync(join(cwd, 'review'), { recursive: true });
    writeFileSync(join(cwd, 'src/scene.ts'), 'export {};');
    writeFileSync(
      join(cwd, 'review/decisions.json'),
      JSON.stringify({ screens: { play: { target: 'review/mock.png', phase: 'mock' } } }),
    );
    git('add', '-A');
    git('commit', '-qm', 'add mock-level target');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:creative phase:build');

    const mockApproval = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'],
      { cwd },
    );
    expect(mockApproval.err.join('\n')).toContain('phase:build needs an approved prototype');

    writeFileSync(
      join(cwd, 'review/decisions.json'),
      JSON.stringify({ screens: { play: { target: 'review/prototype.png', phase: 'prototype' } } }),
    );
    const prototypeApproval = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'],
      { cwd },
    );
    expect(prototypeApproval.err.join('\n')).not.toContain('phase:build needs an approved prototype');

    writeFileSync(
      join(cwd, 'review/decisions.json'),
      JSON.stringify({ screens: { play: { target: 'review/unknown.png', phase: 'unlisted' } } }),
    );
    const unknownPhase = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'],
      { cwd },
    );
    expect(unknownPhase.err.join('\n')).toContain('phase:build needs an approved prototype');
  });

  it('requires a request record with pack references for creative mock images', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'review/mocks'), { recursive: true });
    writeFileSync(join(cwd, 'review/mocks/mock.png'), 'mock');
    writeFileSync(
      join(cwd, 'review/mocks/request.json'),
      JSON.stringify({ kind: 'image', out: 'review/mocks', file: 'mock.png', refs: [], prompt: 'A town scene' }),
    );
    git('add', '-A');
    git('commit', '-qm', 'add unreferenced creative mock');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:creative phase:mock');

    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main'], { cwd });

    expect(result.err.join('\n')).toContain('needs at least two assets-local/packs or assets-local/sets refs');
  });

  it('requires glass references and ticket-specific coverage before skipping a mock', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'docs/design/ogm-glass'), { recursive: true });
    writeFileSync(
      join(cwd, 'docs/design/ogm-glass/screens.md'),
      '| Account | [Account](https://example.test/#artboard-Account) | #123 |\n',
    );
    git('add', '-A');
    git('commit', '-qm', 'record approved screen');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(join(cwd, 'review/mocks'), { recursive: true });
    writeFileSync(join(cwd, 'review/mocks/mock.png'), 'mock');
    const record = {
      kind: 'image',
      out: 'review/mocks',
      file: 'mock.png',
      refs: ['assets-local/packs/kit/a.png', 'assets-local/packs/kit/b.png'],
    };
    writeFileSync(join(cwd, 'review/mocks/request.json'), JSON.stringify(record));
    git('add', '-A');
    git('commit', '-qm', 'add glass mock');
    writeFileSync(join(cwd, 'pr.md'), 'Closes #123');
    const flags = ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--design', 'ogm-glass'];
    const missing = await gm([...flags, '--phase', 'mock'], { cwd });
    expect(missing.err.join('\n')).toContain('needs an approved OGM glass design image reference');
    mkdirSync(join(cwd, 'assets-local/review/design-ogm-glass'), { recursive: true });
    writeFileSync(join(cwd, 'assets-local/review/design-ogm-glass/Account.png'), 'design');
    record.refs = ['assets-local/review/design-ogm-glass/Account.png'];
    writeFileSync(join(cwd, 'review/mocks/request.json'), JSON.stringify(record));
    const referenced = await gm([...flags, '--phase', 'mock'], { cwd });
    expect(referenced.err.join('\n')).not.toContain('needs an approved OGM glass design image reference');
    expect(referenced.err.join('\n')).not.toContain('needs at least two assets-local/packs');
    const absentScreen = await gm([...flags, '--phase', 'prototype'], { cwd });
    expect(absentScreen.err.join('\n')).toContain('phase:prototype needs an approved mock');
    const wrongScreen = await gm([...flags, '--phase', 'prototype', '--design-screen', 'Settings'], { cwd });
    expect(wrongScreen.err.join('\n')).toContain('phase:prototype needs an approved mock');
    const prototype = await gm([...flags, '--phase', 'prototype', '--design-screen', 'Account'], { cwd });
    expect(prototype.err.join('\n')).not.toContain('phase:prototype needs an approved mock');
    writeFileSync(join(cwd, 'pr.md'), 'Closes #124');
    const wrongTicket = await gm([...flags, '--phase', 'prototype', '--design-screen', 'Account'], { cwd });
    expect(wrongTicket.err.join('\n')).toContain('phase:prototype needs an approved mock');
    writeFileSync(join(cwd, 'pr.md'), 'Closes #123');
    const build = await gm([...flags, '--phase', 'build', '--design-screen', 'Account'], { cwd });
    expect(build.err.join('\n')).toContain('phase:build needs an approved prototype');
  });

  it('accepts a creative mock with two pack or set references and a matching output record', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'review/mocks'), { recursive: true });
    writeFileSync(join(cwd, 'review/mocks/mock.png'), 'mock');
    writeFileSync(
      join(cwd, 'review/mocks/request.json'),
      JSON.stringify({
        kind: 'image',
        out: 'review/mocks',
        file: 'mock.png',
        refs: ['assets-local/packs/kit/frame.png', 'assets-local/sets/town/render.png'],
        prompt: 'A town in the same game style and camera angle as the kit',
      }),
    );
    git('add', '-A');
    git('commit', '-qm', 'add referenced creative mock');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:creative phase:mock');

    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main'], { cwd });

    expect(result.err.join('\n')).not.toContain('needs at least two assets-local/packs or assets-local/sets refs');
    expect(result.err.join('\n')).not.toContain('request-mock image record');

    writeFileSync(join(cwd, 'review/mocks/extra.png'), 'extra mock');
    git('add', '-A');
    git('commit', '-qm', 'add unmatched mock image');
    const unmatched = await gm(['check', '--body', 'pr.md', '--base', 'origin/main'], { cwd });
    expect(unmatched.err.join('\n')).toContain('extra.png has no matching request-mock image record');

    writeFileSync(
      join(cwd, 'review/mocks/request.json'),
      JSON.stringify({ kind: 'image', out: 'review/mocks', file: 'mock.png', refs: [], prompt: 'A town scene' }),
    );
    const rejected = await gm(['check', '--body', 'pr.md', '--base', 'origin/main'], { cwd });
    expect(rejected.err.join('\n')).toContain('needs at least two assets-local/packs or assets-local/sets refs');
  });

  it('accepts one game logo reference for a logo-derived title mock', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'review/mocks'), { recursive: true });
    writeFileSync(join(cwd, 'review/mocks/title.png'), 'mock');
    writeFileSync(
      join(cwd, 'review/mocks/request.json'),
      JSON.stringify({
        kind: 'image',
        out: 'review/mocks',
        file: 'title.png',
        refs: ['assets-local/logo/game-logo.png'],
        prompt: 'Title screen using the provided game logo viewpoint',
      }),
    );
    git('add', '-A');
    git('commit', '-qm', 'add logo-derived title mock');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:creative phase:mock');

    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main'], { cwd });

    expect(result.err.join('\n')).not.toContain('needs at least two assets-local/packs or assets-local/sets refs');

    writeFileSync(
      join(cwd, 'review/mocks/request.json'),
      JSON.stringify({
        kind: 'image',
        out: 'review/mocks',
        file: 'title.png',
        refs: ['assets-local/logo/game-logo.png'],
        prompt: 'An ordinary landscape without screen direction',
      }),
    );
    const rejected = await gm(['check', '--body', 'pr.md', '--base', 'origin/main'], { cwd });
    expect(rejected.err.join('\n')).toContain('needs at least two assets-local/packs or assets-local/sets refs');
  });

  it('requires a matching request-mock record for changed image files', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'review/mocks'), { recursive: true });
    writeFileSync(join(cwd, 'review/mocks/mock.png'), 'mock');
    git('add', '-A');
    git('commit', '-qm', 'add mock image without request record');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:creative phase:mock');

    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main'], { cwd });

    expect(result.err.join('\n')).toContain('request-mock image record');
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

  it('requires the generated sprite named by the clone recipe', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'round/originals'), { recursive: true });
    writeFileSync(join(cwd, 'round/originals/source.png'), 'source');
    writeFileSync(join(cwd, 'round/recipe.json'), JSON.stringify(spriteRecipe()));
    git('add', '-A');
    git('commit', '-qm', 'add clone recipe without output');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:clone');

    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'clone'], { cwd });

    expect(result.err.join('\n')).toContain('has no generated sprite attached at round/rock_N.png');
  });

  it('rejects clone recipes with failing gate results', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'round/originals'), { recursive: true });
    writeFileSync(join(cwd, 'round/originals/source.png'), 'source');
    writeFileSync(
      join(cwd, 'round/recipe.json'),
      JSON.stringify({
        ...spriteRecipe(),
        gate_results: { prop: { pass: false } },
      }),
    );
    git('add', '-A');
    git('commit', '-qm', 'add clone recipe and source');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:clone');
    const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'clone'], { cwd });
    expect(result.err.join('\n')).toContain('missing or failing gm-sprite-forge gate results');
  });

  it('accepts a complete clone bundle and rejects missing approval or scores', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'round/originals'), { recursive: true });
    writeFileSync(join(cwd, 'round/originals/source.png'), 'source');
    writeFileSync(join(cwd, 'round/rock_N.png'), 'generated sprite');
    const recipe = spriteRecipe();
    writeFileSync(join(cwd, 'round/recipe.json'), JSON.stringify(recipe));
    git('add', '-A');
    git('commit', '-qm', 'add complete clone bundle');
    writeFileSync(join(cwd, 'pr.md'), 'Labels: lane:clone');

    const accepted = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'clone'], { cwd });
    expect(accepted.err.join('\n')).not.toContain('no creator approval');
    expect(accepted.err.join('\n')).not.toContain('no gm-sprite-forge gate scores');
    expect(accepted.err.join('\n')).not.toContain('missing or failing gm-sprite-forge gate results');

    recipe.approved_by_creator = false;
    writeFileSync(join(cwd, 'round/recipe.json'), JSON.stringify(recipe));
    const unapproved = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'clone'], { cwd });
    expect(unapproved.err.join('\n')).toContain('has no creator approval');

    recipe.approved_by_creator = true;
    recipe.scores = {};
    writeFileSync(join(cwd, 'round/recipe.json'), JSON.stringify(recipe));
    const unscored = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'clone'], { cwd });
    expect(unscored.err.join('\n')).toContain('has no gm-sprite-forge gate scores');

    recipe.scores = { silhouette: 0.9 };
    recipe.gate_results = {};
    writeFileSync(join(cwd, 'round/recipe.json'), JSON.stringify(recipe));
    const withoutGateResults = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'clone'], {
      cwd,
    });
    expect(withoutGateResults.err.join('\n')).toContain('missing or failing gm-sprite-forge gate results');
  });

  it('does not let another game’s decision record approve this game’s build rung', async () => {
    const { cwd, git } = repo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    mkdirSync(join(cwd, 'docs/other-game'), { recursive: true });
    writeFileSync(join(cwd, 'src/scene.ts'), 'export {};');
    writeFileSync(
      join(cwd, 'docs/other-game/decisions.json'),
      JSON.stringify({ screens: { title: { target: 'mock.png' } } }),
    );
    git('add', '-A');
    git('commit', '-qm', 'add unrelated decision');
    writeFileSync(join(cwd, 'pr.md'), 'Prototype review: none');
    const result = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'],
      { cwd },
    );
    expect(result.err.join('\n')).toContain('phase:build needs an approved prototype');
  });

  it('requires an answered, media-backed decision tied to this ticket', async () => {
    const { cwd } = repo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    mkdirSync(join(cwd, 'docs', basename(cwd)), { recursive: true });
    writeFileSync(join(cwd, 'src/scene.ts'), 'export {};');
    const decision = {
      id: 'approved-mock',
      area: 'screen',
      question: 'Choose a mock',
      why: 'visual direction',
      options: [
        { label: 'A', media: 'mock-a.png' },
        { label: 'B', media: 'mock-b.png' },
      ],
      recommendation: 'A: clearer',
      sources: ['image mock'],
      ticket: 999,
      status: 'answered',
      answer: 'A',
      answered_at: '2026-11-20T00:00:00Z',
    };
    writeFileSync(join(cwd, 'docs', basename(cwd), 'decisions.json'), JSON.stringify([decision]));
    writeFileSync(join(cwd, 'pr.md'), 'Refs #1106\nPrototype review: none');
    const result = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'],
      { cwd },
    );
    expect(result.err.join('\n')).toContain('phase:build needs an approved prototype');
  });

  it('accepts an answered, media-backed decision tied to this ticket', async () => {
    const { cwd } = repo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    mkdirSync(join(cwd, 'docs', basename(cwd)), { recursive: true });
    writeFileSync(join(cwd, 'src/scene.ts'), 'export {};');
    const decision = {
      id: 'approved-mock',
      area: 'screen',
      question: 'Choose a mock',
      why: 'visual direction',
      options: [
        { label: 'A', media: 'mock-a.png' },
        { label: 'B', media: 'mock-b.png' },
      ],
      recommendation: 'A: clearer',
      sources: ['image mock'],
      phase: 'mock',
      ticket: 1106,
      status: 'answered',
      answer: 'A',
      answered_at: '2026-11-20T00:00:00Z',
    };
    writeFileSync(join(cwd, 'docs', basename(cwd), 'decisions.json'), JSON.stringify([decision]));
    writeFileSync(join(cwd, 'pr.md'), 'Refs #1106\nPrototype review: none');
    const buildFromMock = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'],
      { cwd },
    );
    expect(buildFromMock.err.join('\n')).toContain('phase:build needs an approved prototype');

    const prototype = { ...decision, phase: 'prototype' };
    writeFileSync(join(cwd, 'docs', basename(cwd), 'decisions.json'), JSON.stringify([prototype]));
    const result = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'],
      { cwd },
    );
    expect(result.err.join('\n')).not.toContain('phase:build needs an approved prototype');

    const incomplete = {
      ...decision,
      options: [{ ...decision.options[0]! }, { label: 'B' }],
    };
    writeFileSync(join(cwd, 'docs', basename(cwd), 'decisions.json'), JSON.stringify([incomplete]));
    const missingOptionMedia = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'],
      { cwd },
    );
    expect(missingOptionMedia.err.join('\n')).toContain('phase:build needs an approved prototype');

    prototype.status = 'pending';
    writeFileSync(join(cwd, 'docs', basename(cwd), 'decisions.json'), JSON.stringify([prototype]));
    const rejected = await gm(
      ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'],
      { cwd },
    );
    expect(rejected.err.join('\n')).toContain('phase:build needs an approved prototype');
  });

  it('reports an unreadable PR body instead of crashing', async () => {
    const { cwd } = repo();
    const result = await gm(
      ['check', '--body', 'missing.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'mock'],
      { cwd },
    );
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('cannot read PR body missing.md');
  });

  it('rejects an unknown ticket lane', async () => {
    const result = await gm(['check', '--lane', 'gameplay']);
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('invalid ticket lane "gameplay". Try: use --lane creative|clone');
  });
});
