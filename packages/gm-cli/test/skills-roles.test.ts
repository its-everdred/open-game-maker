import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

/* #656, Kevin 2026-11-08: a ticket's role labels decide which skills aiur inlines before the worker starts, so a
   planned ticket with no game or no known role would start without the skills its work needs. */
describe('gm plan check', () => {
  async function check(tickets: unknown[], ...extra: string[]) {
    const root = tempDir('gm-plan-check-');
    writeFileSync(join(root, 'issues.json'), JSON.stringify(tickets));
    return gm(['plan', 'check', '--tickets', 'issues.json', ...extra], { cwd: root });
  }

  it('passes tickets that carry their game and a known role, and skips the new-game parent', async () => {
    const result = await check([
      { number: 1, title: 'Skeleton', labels: [{ name: 'game:blobs' }, { name: 'role:gameplay' }] },
      { number: 2, title: 'HUD', labels: ['game:blobs', 'role:visual', 'role:3d', 'priority:1'] },
      { number: 3, title: 'Blobs', labels: [{ name: 'request:new-game' }] },
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toEqual(['plan ok: 2 tickets carry a game and a role']);
  });

  it('fails a ticket filed without a role, without its game, with two games or with a role not in roles.md', async () => {
    const result = await check(
      [
        { number: 4, labels: ['game:blobs'] },
        { number: 5, labels: ['role:audio'] },
        { number: 6, labels: ['game:blobs', 'role:painter'] },
        { number: 7, labels: ['game:blobs', 'game:castle', 'role:qa'] },
      ],
      '--game',
      'blobs',
    );
    expect(result.code).toBe(1);
    expect(result.out).toEqual([
      '#4: no role:* label from gm-core/references/roles.md',
      '#5: no game:<slug> label',
      '#6: role:painter is not a role in gm-core/references/roles.md; no role:* label from gm-core/references/roles.md',
      '#7: more than one game label (game:blobs, game:castle)',
    ]);
  });

  it("skips a sibling game's tickets in a shared instance repo when --game names the planned game", async () => {
    const root = tempDir('gm-plan-check-');
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, 'docs', 'blobs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'blobs', 'decisions.json'), JSON.stringify([]));
    writeFileSync(
      join(root, 'issues.json'),
      JSON.stringify([
        { number: 8, body: '## Creator decisions\n- None\n', labels: ['game:blobs', 'role:qa'] },
        { number: 9, labels: ['game:castle'] },
      ]),
    );
    const result = await gm(['plan', 'check', '--tickets', 'issues.json', '--game', 'blobs', '--json'], { cwd: root });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!)).toEqual({ checked: 1, failed: [], inventoryProblems: [], ok: true });
  });

  it('fails loud when there is nothing to check, so a wrong tickets file never reads as a clean plan', async () => {
    const result = await check([{ number: 10, labels: ['request:new-game'] }]);
    expect(result.code).toBe(1);
    expect(result.err).toEqual(['no tickets to check in issues.json']);
  });

  it('requires a decision inventory when checking a game plan', async () => {
    const root = tempDir('gm-plan-check-');
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(
      join(root, 'issues.json'),
      JSON.stringify([{ number: 12, body: '## Creator decisions\n- None\n', labels: ['game:blobs', 'role:qa'] }]),
    );
    const result = await gm(['plan', 'check', '--tickets', 'issues.json', '--game', 'blobs'], { cwd: root });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('game blobs has no valid docs/blobs/decisions.json');
  });

  it('rejects malformed inventories and incomplete decision links in game tickets', async () => {
    const base = tempDir('gm-plan-inventory-');
    execFileSync('git', ['init', '-q'], { cwd: base });
    mkdirSync(join(base, 'docs', 'blobs'), { recursive: true });
    const inventory = [
      {
        id: 'enemy-style',
        area: 'Enemies',
        question: 'Which enemies?',
        why: 'Sets the tone.',
        options: [{ label: 'Slimes', media_needed: 'slime still' }, { label: 'Golems', media_needed: 'golem still' }],
        recommendation: 'Slimes: existing pack art.',
        sources: ['brief.md'],
        ticket: null,
        status: 'open',
        answer: null,
        answered_at: null,
      },
    ];
    writeFileSync(join(base, 'docs', 'blobs', 'decisions.json'), JSON.stringify(inventory));
    const ticketsFile = join(base, 'issues.json');
    const run = async (tickets: unknown[]) => {
      writeFileSync(ticketsFile, JSON.stringify(tickets));
      return gm(['plan', 'check', '--tickets', 'issues.json', '--game', 'blobs', '--json'], { cwd: base });
    };
    const missingBody = await run([{ number: 20, labels: ['game:blobs', 'role:qa'] }]);
    expect(JSON.parse(missingBody.out[0]!).inventoryProblems).toContain(
      '#20 body missing; use gh issue list --json number,title,labels,body',
    );
    const missingSection = await run([
      { number: 20, body: 'No decision section.', labels: ['game:blobs', 'role:qa'] },
    ]);
    expect(JSON.parse(missingSection.out[0]!).inventoryProblems).toContain('#20 has no ## Creator decisions section');
    const unknownId = await run([
      { number: 20, body: '## Creator decisions\n- other-choice\n', labels: ['game:blobs', 'role:qa'] },
    ]);
    expect(JSON.parse(unknownId.out[0]!).inventoryProblems).toContain('#20 lists unknown decision other-choice');
    const unassigned = await run([{ number: 20, body: '## Creator decisions\n- None\n', labels: ['game:blobs', 'role:qa'] }]);
    expect(JSON.parse(unassigned.out[0]!).inventoryProblems).toContain('decision enemy-style is not listed on a game:blobs ticket');
    inventory[0]!.ticket = 21;
    writeFileSync(join(base, 'docs', 'blobs', 'decisions.json'), JSON.stringify(inventory));
    const wrongTicket = await run([
      { number: 20, body: '## Creator decisions\n- enemy-style\n', labels: ['game:blobs', 'role:qa'] },
    ]);
    expect(JSON.parse(wrongTicket.out[0]!).inventoryProblems).toContain(
      'decision enemy-style is assigned to ticket #21 but listed on #20',
    );
    writeFileSync(join(base, 'docs', 'blobs', 'decisions.json'), '{invalid');
    const malformed = await run([{ number: 20, body: '## Creator decisions\n- None\n', labels: ['game:blobs', 'role:qa'] }]);
    expect(malformed.code).toBe(1);
    expect(JSON.parse(malformed.out[0]!).inventoryProblems[0]).toContain('game blobs has no valid');
  });

  it('reads the roles from the platform pack the builder uses, never a game repo’s older installed copy', async () => {
    const root = tempDir('gm-plan-check-');
    mkdirSync(join(root, '.claude/skills/gm-core/references'), { recursive: true });
    writeFileSync(join(root, '.claude/skills/gm-core/references/roles.md'), '| `role:painter` | art | gm-core |\n');
    writeFileSync(join(root, 'issues.json'), JSON.stringify([{ number: 11, labels: ['game:blobs', 'role:painter'] }]));
    expect((await gm(['plan', 'check', '--tickets', 'issues.json'], { cwd: root })).code).toBe(1);
    const pack = join(root, 'pack');
    mkdirSync(join(pack, 'gm-core/references'), { recursive: true });
    writeFileSync(join(pack, 'gm-core/references/roles.md'), '| `role:painter` | art | gm-core |\n');
    const overridden = await gm(['plan', 'check', '--tickets', 'issues.json'], {
      cwd: root,
      env: { GM_SKILLS_DIR: pack },
    });
    expect(overridden.code).toBe(0);
  });
});

describe('gm skills config', () => {
  it('prints the agent.skills block: each game with its set skill, then every role', async () => {
    const root = tempDir('gm-skills-config-');
    for (const [slug, lock] of [
      ['blobs', { v: 1, set: 'kaykit' }],
      ['sketch', { v: 1 }],
    ] as const) {
      mkdirSync(join(root, 'games', slug), { recursive: true });
      writeFileSync(join(root, 'games', slug, 'gm.lock.json'), JSON.stringify(lock));
    }
    const result = await gm(['skills', 'config'], { cwd: root });
    expect(result.code).toBe(0);
    expect(result.out.slice(0, 7)).toEqual([
      'agent:',
      '  skills:',
      '    preload_max_bytes: 49152',
      '    by_label:',
      '      "game:blobs": [gm-core, gm-set-kaykit]',
      '      "game:sketch": [gm-core]',
      '      "role:visual": [gm-core, gm-verify, gm-ui-hud, gm-image-mock, gm-dream-loop]',
    ]);
    expect(result.out).toContain(
      '      "role:assets": [gm-core, gm-verify, gm-asset-variants, gm-pack-adapter, gm-asset-showcase, gm-dream-loop]',
    );
    expect(result.out).toContain('      "role:gameplay": [gm-core, gm-input, gm-verify, gm-qa, gm-map-inspiration]');
  });
});

describe('gm skills search and show', () => {
  it('finds on-demand skills by words, name hits first', async () => {
    const result = await gm(['skills', 'search', 'audio', '--limit', '100'], {});
    expect(result.code).toBe(0);
    const names = result.out.map((line) => line.split('  ')[0]!);
    expect(names).toContain('gm-audio');
    const firstDescriptionOnly = names.findIndex((name) => !name.includes('audio'));
    expect(firstDescriptionOnly).toBeGreaterThan(names.indexOf('gm-audio'));
    expect(names.slice(firstDescriptionOnly).every((name) => !name.includes('audio'))).toBe(true);
  });

  it('discovers the AnyMachine Blender skill', async () => {
    const search = await gm(['skills', 'search', 'blender', 'rig'], {});
    expect(search.out.some((line) => line.startsWith('anymachine  '))).toBe(true);
    const show = await gm(['skills', 'show', 'anymachine'], {});
    expect(show.code).toBe(0);
    expect(show.out.join('\n')).toContain('name: anymachine');
  });

  it('fails loud when nothing matches', async () => {
    const result = await gm(['skills', 'search', 'zzzqqq'], {});
    expect(result.code).toBe(1);
    expect(result.err).toEqual(['no skill matches zzzqqq']);
  });

  it('prints a skill with the role labels that inline it', async () => {
    const result = await gm(['skills', 'show', 'gm-qa'], {});
    expect(result.code).toBe(0);
    expect(result.out[0]).toBe('mandatory for: role:gameplay, role:qa, role:multiplayer');
    expect(result.out[1]).toMatch(/^---\nname: gm-qa\n/);
    const json = JSON.parse((await gm(['skills', 'show', 'gm-qa', '--json'], {})).out[0]!);
    expect(json.mandatoryFor).toEqual(['role:gameplay', 'role:qa', 'role:multiplayer']);
  });

  it('searches a game repo’s installed skills instead of the platform pack', async () => {
    const root = tempDir('gm-skills-search-');
    mkdirSync(join(root, '.claude/skills/gm-only-here'), { recursive: true });
    writeFileSync(
      join(root, '.claude/skills/gm-only-here/SKILL.md'),
      '---\nname: gm-only-here\ndescription: >\n  Use when the lighthouse\n  needs a beam.\n---\n# Here\n',
    );
    const result = await gm(['skills', 'search', 'lighthouse'], { cwd: root });
    expect(result.out).toEqual(['gm-only-here  Use when the lighthouse needs a beam.']);
    expect((await gm(['skills', 'search', 'audio'], { cwd: root })).code).toBe(1);
  });
});
