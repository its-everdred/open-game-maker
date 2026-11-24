import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';
import { injectBlock, rank, verdicts } from '../src/related-work.js';

/*
 * The case behind #1311: the forest ticket (#41) rebuilt the lush ground and dressing the fields ticket (#40) had
 * already got approved, and UI tickets rebuilt the journal kit #16 had got approved. `gm context` must point the
 * worker at that earlier work, and leave out work the creator turned down or that has nothing to do with the ticket.
 */
const labels = (...names: string[]) => names.map((name) => ({ name }));
const issues = {
  41: {
    number: 41,
    title: 'Biome direction: forest and graveyard approach, reusable compositions and natural boundaries',
    body: 'Dense forest with ground transitions between dirt and grass. Trees, foliage and rocks.',
    labels: labels('game:dusk', 'role:visual', 'role:assets', 'feature:dusk'),
  },
  40: {
    number: 40,
    title: 'Biome direction: lush fields, reusable compositions and natural boundaries',
    body: 'Lush fields with dense trees, foliage, rocks and a dirt and grass ground study.',
    labels: labels('game:dusk', 'role:visual', 'role:assets', 'feature:dusk'),
  },
  16: {
    number: 16,
    title: 'Responsive HUD, touch controls, dialogue and menus',
    body: 'HUD, dialogue box and menus in the approved UI kit.',
    labels: labels('game:dusk', 'role:visual', 'feature:dusk'),
  },
  45: {
    number: 45,
    title: 'Biome direction: swamp compositions and natural boundaries',
    body: 'Swamp ground with trees and rocks.',
    labels: labels('game:dusk', 'role:visual', 'role:assets', 'feature:dusk'),
  },
  60: {
    number: 60,
    title: 'Inventory screen',
    body: 'The inventory grid and item menus, in the game UI kit.',
    labels: labels('game:dusk', 'role:visual', 'feature:dusk'),
  },
  70: { number: 70, title: 'Loose ticket', body: 'No game label.', labels: labels('role:visual') },
};
const comments = {
  40: [
    {
      association: 'OWNER',
      createdAt: '2026-11-21T21:23:03Z',
      body: "Kevin's review-page verdict, his words: Riverbank: Dislike. looks terrible",
    },
    {
      association: 'OWNER',
      createdAt: '2026-11-23T00:04:43Z',
      body: "Kevin's review-page verdict, his words: Riverbank: Like; Hillside: Like · Approve → Build.",
    },
  ],
  16: [
    {
      association: 'OWNER',
      createdAt: '2026-11-20T10:00:00Z',
      body: '## Answered decision\n\n**Question:** Which UI kit?\n\n**Answer:** b: Leather journal\n',
    },
  ],
  45: [
    {
      association: 'OWNER',
      createdAt: '2026-11-22T10:00:00Z',
      body: "Kevin's review-page verdict, his words: Swamp: Dislike. needs revision",
    },
    /* Anyone can comment on a public repo: a stranger's verdict-shaped comment must never count. */
    {
      association: 'NONE',
      createdAt: '2026-11-23T10:00:00Z',
      body: "Kevin's review-page verdict, his words: Swamp: Like · Approve → Ship.",
    },
  ],
  60: [],
};
const REPO = 'https://api.github.com/repos/owner/games';
const pulls = [
  {
    number: 907,
    title: 'Make the liked lush fields walkable',
    body: 'Refs #40',
    repo: REPO,
    files: ['games/dusk/src/features/fields/terrain.ts', 'games/dusk/tests/fields-terrain.test.ts'],
  },
  /* The forest's own PR mentions the fields ticket: it belongs to #41, not #40. */
  {
    number: 894,
    title: 'Build forest approach',
    body: 'Refs #41, after #40',
    repo: REPO,
    files: ['games/dusk/src/forest.ts'],
  },
  /* A core PR that mentions #40 lives in another repository. */
  {
    number: 1237,
    title: 'Core verify scene',
    body: 'Closes #1216; see #40',
    repo: 'https://api.github.com/repos/owner/core',
    files: [],
  },
];
const decisions = [
  {
    id: 'ui-kit',
    area: 'inventory-ui',
    question: 'Which UI kit?',
    options: [
      { label: 'Stone', media: 'assets-local/review/dusk/16/swatch-a.png' },
      { label: 'Leather journal', media: 'assets-local/review/dusk/16/swatch-b.png' },
    ],
    ticket: 16,
    status: 'answered',
    answer: 'Leather journal',
    answered_at: '2026-11-20T10:00:00Z',
    reuse: { paths: ['games/dusk/src/ui/journal-kit.ts'], generator: 'games/dusk/scripts/journal-kit.py' },
  },
  {
    id: 'hud-layout',
    area: 'hud-controls',
    question: 'Which HUD layout?',
    options: [{ label: 'Corner bars' }, { label: 'Bottom strip' }],
    recommendation: 'Corner bars: keeps the play area clear',
    ticket: 16,
    status: 'defaulted',
    answer: null,
    answered_at: null,
  },
  {
    id: 'swamp-water',
    area: 'world-biomes',
    question: 'How murky is the water?',
    options: [{ label: 'Clear' }, { label: 'Murky' }],
    ticket: 45,
    status: 'open',
    answer: null,
    answered_at: null,
  },
];

function fixture() {
  const root = tempDir('gm-context-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'docs', 'dusk'), { recursive: true });
  writeFileSync(join(root, 'docs', 'dusk', 'decisions.json'), JSON.stringify(decisions));
  mkdirSync(join(root, 'games', 'dusk', 'review', '40', 'kit'), { recursive: true });
  writeFileSync(join(root, 'games', 'dusk', 'review', '40', 'kit', 'compose.py'), '');
  writeFileSync(join(root, 'games', 'dusk', 'review', '40', 'kit', 'ground.png'), '');
  writeFileSync(
    join(root, 'games', 'dusk', 'review', 'decisions.json'),
    JSON.stringify({ screens: { 'fields-ground': { target: 'review/40/kit/ground.png', phase: 'build' } } }),
  );
  mkdirSync(join(root, 'assets-local', 'review', 'dusk', '40-build'), { recursive: true });

  const bin = join(root, 'bin');
  mkdirSync(bin);
  const data = join(root, 'gh.json');
  writeFileSync(data, JSON.stringify({ issues, comments, pulls, repo: REPO }));
  /* A .cjs file so the fake runs as CommonJS under any package.json above the temp dir; it answers each `gh api`
     read with the JSON lines the real `--jq` filter would print. */
  writeFileSync(
    join(bin, 'gh.cjs'),
    `const { issues, comments, pulls, repo } = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(data)}, 'utf8'));
const [cmd, , path] = process.argv.slice(2);
if (cmd !== 'api') process.exit(1);
const line = (v) => process.stdout.write(JSON.stringify(v) + '\\n');
const issue = (i) => ({ number: i.number, title: i.title, body: i.body, labels: i.labels.map((l) => l.name), repo });
let m;
if ((m = /issues\\/(\\d+)\\/timeline/.exec(path))) {
  if (process.env.FAIL_TIMELINE === m[1]) (process.stderr.write('TLS handshake timeout'), process.exit(1));
  for (const c of comments[m[1]] ?? []) line({ comment: c });
  for (const p of pulls) if (new RegExp('#' + m[1] + '\\\\b').test(p.body)) line({ pull: { number: p.number, title: p.title, body: p.body, repo: p.repo } });
} else if ((m = /pulls\\/(\\d+)\\/files/.exec(path))) {
  if (process.env.FAIL_FILES === m[1]) process.exit(1);
  for (const f of pulls.find((p) => p.number === Number(m[1])).files) line(f);
}
else if ((m = /issues\\?labels=([^&]+)/.exec(path))) {
  const label = decodeURIComponent(m[1]);
  for (const i of Object.values(issues)) if (i.labels.some((l) => l.name === label)) line(issue(i));
} else if ((m = /issues\\/(\\d+)$/.exec(path))) issues[m[1]] ? line(issue(issues[m[1]])) : process.exit(1);
else process.exit(1);
`,
  );
  const fake = join(bin, 'gh');
  writeFileSync(fake, `#!/bin/sh\nexec node "${join(bin, 'gh.cjs')}" "$@"\n`);
  chmodSync(fake, 0o755);
  return { root, env: { PATH: `${bin}:${process.env.PATH}` } };
}

describe('gm context', () => {
  it('points a forest ticket at the approved fields ground and dressing, not at rejected or unrelated work', async () => {
    const { root, env } = fixture();
    const result = await gm(['context', '41'], { cwd: root, env });
    expect(result.code).toBe(0);
    const text = result.out.join('\n');
    const bullets = result.out.filter((line) => line.startsWith('- '));
    expect(bullets[0]).toContain('#40 Biome direction: lush fields');
    expect(bullets[0]).toContain('approved 2026-11-23: "Riverbank: Like; Hillside: Like · Approve → Build."');
    expect(text).toContain('PR #907 Make the liked lush fields walkable: games/dusk/src/features/fields/terrain.ts');
    expect(text).toContain('Media: games/dusk/review/40/, assets-local/review/dusk/40-build/');
    expect(text).toContain('Generators: games/dusk/review/40/kit/compose.py');
    expect(text).toContain('Approved screen `fields-ground` (build): games/dusk/review/40/kit/ground.png');
    /* #45 has only a rejection and no merged work; its open decision has not been answered. */
    expect(text).not.toContain('#45');
    expect(text).not.toContain('PR #894');
    expect(text).not.toContain('PR #1237');
    expect(text).not.toContain('swamp-water');
  });

  it("points a UI ticket at #16's approved journal kit with its media and reusable outputs", async () => {
    const { root, env } = fixture();
    const result = await gm(['context', '60'], { cwd: root, env });
    expect(result.code).toBe(0);
    const text = result.out.join('\n');
    expect(text).toContain(
      '#16 Responsive HUD, touch controls, dialogue and menus — approved 2026-11-20: "b: Leather journal"',
    );
    expect(text).toContain('Decision `ui-kit` (#16): Which UI kit? → "Leather journal"');
    expect(text).toContain('Media: assets-local/review/dusk/16/swatch-b.png, games/dusk/src/ui/journal-kit.ts');
    expect(text).toContain('Generator: games/dusk/scripts/journal-kit.py');
    expect(text).not.toContain('swatch-a.png');
  });

  it('writes the block into the workspace gm-core skill once, so the dispatched prompt inlines it', async () => {
    const { root, env } = fixture();
    const skill = join(root, '.claude', 'skills', 'gm-core', 'SKILL.md');
    mkdirSync(join(skill, '..'), { recursive: true });
    writeFileSync(skill, '---\nname: gm-core\n---\n\n# Game Maker core\n');
    expect((await gm(['context', '41', '--inject', '.claude/skills'], { cwd: root, env })).code).toBe(0);
    expect((await gm(['context', '41', '--inject', join(root, '.claude/skills')], { cwd: root, env })).code).toBe(0);
    const text = readFileSync(skill, 'utf8');
    expect(text.startsWith('---\nname: gm-core\n---\n\n# Game Maker core\n\n<!-- gm-context:start -->')).toBe(true);
    expect(text.match(/## Build on this approved work/g)).toHaveLength(1);
    expect(text).toContain('#40 Biome direction: lush fields');
  });

  it('still lists the rest when one sibling timeline cannot be read', async () => {
    const { root, env } = fixture();
    const result = await gm(['context', '60'], { cwd: root, env: { ...env, FAIL_TIMELINE: '16' } });
    expect(result.code).toBe(0);
    expect(result.err.join('\n')).toContain('skipped #16');
    expect(result.out.join('\n')).toContain('Decision `ui-kit` (#16)');
  });

  it("keeps a ticket's approval when one of its PRs' files cannot be read", async () => {
    const { root, env } = fixture();
    const result = await gm(['context', '41'], { cwd: root, env: { ...env, FAIL_FILES: '907' } });
    expect(result.code).toBe(0);
    expect(result.err.join('\n')).toContain('no files for PR #907');
    expect(result.out.join('\n')).toContain(
      '#40 Biome direction: lush fields, reusable compositions and natural boundaries — approved',
    );
  });

  it('lists a defaulted decision with the recommendation that stands', async () => {
    const { root, env } = fixture();
    const result = await gm(['context', '16'], { cwd: root, env });
    expect(result.out.join('\n')).toContain(
      'Decision `hud-layout` (#16): Which HUD layout? → "Corner bars: keeps the play area clear"',
    );
  });

  it('never leaves an earlier list standing when a refresh fails', async () => {
    const { root, env } = fixture();
    const skill = join(root, '.claude', 'skills', 'gm-core', 'SKILL.md');
    mkdirSync(join(skill, '..'), { recursive: true });
    writeFileSync(skill, '# Game Maker core\n');
    expect((await gm(['context', '41', '--inject', '.claude/skills'], { cwd: root, env })).code).toBe(0);
    expect(
      (await gm(['context', '41', '--inject', '.claude/skills'], { cwd: root, env: { ...env, FAIL_TIMELINE: '41' } }))
        .code,
    ).toBe(1);
    const text = readFileSync(skill, 'utf8');
    expect(text).toContain('`gm context 41` did not finish. Run it yourself');
    expect(text).not.toContain('#40 Biome direction');
    expect((await gm(['context', '70', '--inject', '.claude/skills'], { cwd: root, env })).code).toBe(2);
    expect(readFileSync(skill, 'utf8')).toBe('# Game Maker core\n');
  });

  it('refuses a ticket that belongs to no game', async () => {
    const { root, env } = fixture();
    const result = await gm(['context', '70'], { cwd: root, env });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('#70 has no game:<slug> label');
  });
});

describe('related work helpers', () => {
  it('reads liked and picked verdicts as approvals and revisions as rejections', () => {
    const review = (text: string) => `Kevin's review-page verdict, his words: ${text}`;
    const found = verdicts(
      [
        review('Riverbank: Dislike; Hillside: Dislike. looks terrible'),
        '## Answered decision\n\n**Answer:** revise: Revise variants\n',
        '## Answered decision\n\n**Answer:** d: Dense grove\n',
        '## Answered decision\n\n**Answer:** changes: Needs changes\n',
        review('Boar: Like; Bull: Dislike. friendly animals too'),
        review('not good, the trees look flat'),
        review("don't like the trees"),
        review('Ship it: Like; Needs changes: Like · Approve → Ship.'),
      ].map((body, i) => ({ association: 'OWNER', createdAt: String(i), body })),
    );
    expect(found.map((v) => v.positive)).toEqual([false, false, true, false, true, false, false, true]);
    expect(verdicts([{ association: 'NONE', createdAt: '9', body: review('Like · Approve') }])).toEqual([]);
  });

  it('drops an approval that a later verdict rejected', () => {
    const verdict = (positive: boolean, at: string) => ({ text: positive ? 'Like' : 'Dislike', at, positive });
    const kept = (history: ReturnType<typeof verdict>[]) =>
      rank({
        target: { number: 41, title: 'Forest', body: 'forest trees', labels: ['role:visual'] },
        candidates: [{ issue: { number: 40, title: 'Fields', body: 'trees', labels: ['role:visual'] }, score: 3 }],
        history: new Map([[40, { verdicts: history, pulls: [] }]]),
        decisions: [],
        screens: [],
        folders: () => ({ media: [], generators: [] }),
        gamePrefix: '',
        limit: 5,
      }).length;
    expect(kept([verdict(true, '1')])).toBe(1);
    expect(kept([verdict(true, '1'), verdict(false, '2')])).toBe(0);
  });

  it('gives every visual ticket the approved UI kit, even one that never names it (#31 rebuilt #16 kit)', () => {
    const shop = {
      number: 31,
      title: 'Merchants within a run',
      body: 'Buy and sell at the stall.',
      labels: [] as string[],
    };
    const ids = (labels: string[]) =>
      rank({
        target: { ...shop, labels },
        candidates: [],
        history: new Map(),
        decisions,
        screens: [],
        folders: () => ({ media: [], generators: [] }),
        gamePrefix: '',
        limit: 5,
      }).map((item) => (item.kind === 'decision' ? item.id : item.kind));
    expect(ids(['game:dusk', 'role:visual'])).toEqual(['ui-kit']);
    expect(ids(['game:dusk', 'role:audio'])).toEqual([]);
  });

  it('removes the block when nothing relates', () => {
    const skill = injectBlock('# core\n', ['## Build on this approved work', '- #40']);
    expect(injectBlock(skill, [])).toBe('# core\n');
  });
});
