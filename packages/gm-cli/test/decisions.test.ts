import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { gm, tempDir } from './helpers.js';
import { syncInventory } from '../src/commands/decisions/sync.js';

const data = [
  {
    id: 'enemy-style',
    area: 'Enemies',
    question: 'Which enemies?',
    why: 'Sets combat tone.',
    options: [
      { label: 'Slimes', media: 'chat-slimes' },
      { label: 'Golems', media_needed: 'golem still' },
    ],
    recommendation: 'Slimes: the pack includes a walk and attack sheet.',
    sources: ['brief.md'],
    ticket: 71,
    status: 'open',
    answer: null,
    answered_at: null,
  },
];
const JOB_ID = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';

function game() {
  const root = tempDir('gm-decisions-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'docs', basename(root)), { recursive: true });
  writeFileSync(join(root, 'gm.manifest.json'), '{}');
  writeFileSync(join(root, 'docs', basename(root), 'decisions.json'), JSON.stringify(data));
  return root;
}

describe('gm decisions', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('renders by area, then rejects stale markdown', async () => {
    const root = game();
    expect(await gm(['decisions', 'render'], { cwd: root })).toMatchObject({ code: 0 });
    const check = await gm(['decisions', 'check'], { cwd: root });
    expect(check.code).toBe(0);
    expect(readFileSync(join(root, 'docs', basename(root), 'decisions.md'), 'utf8')).toContain('## Enemies');
    writeFileSync(join(root, 'docs', basename(root), 'decisions.md'), 'stale');
    expect((await gm(['decisions', 'check'], { cwd: root })).err.join('\n')).toContain('stale');
  });

  it('creates the inventory directory when rendering a valid root inventory', async () => {
    const root = game();
    const file = join(root, 'docs', basename(root), 'decisions.json');
    const inventory = readFileSync(file, 'utf8');
    execFileSync('rm', ['-rf', join(root, 'docs', basename(root))]);
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'docs', basename(root)), { recursive: true });
    writeFileSync(file, inventory);
    expect(await gm(['decisions', 'render'], { cwd: root })).toMatchObject({ code: 0 });
    expect(readFileSync(join(root, 'docs', basename(root), 'decisions.md'), 'utf8')).toContain('## Enemies');
  });

  it('lists open decisions assigned to a ticket as JSON', async () => {
    const root = game();
    const result = await gm(['decisions', 'next', '--ticket', '71'], { cwd: root });
    expect(JSON.parse(result.out[0]!)).toMatchObject({ ticket: '71', decisions: [{ id: 'enemy-style' }] });
  });

  it('includes decisions linked from a ticket body before ticket numbers are written into the inventory', async () => {
    const root = game();
    const inventory = structuredClone(data);
    inventory[0]!.ticket = null;
    writeFileSync(join(root, 'docs', basename(root), 'decisions.json'), JSON.stringify(inventory));
    writeFileSync(join(root, 'ticket.md'), '## Creator decisions\n- enemy-style\n');
    const result = await gm(['decisions', 'next', '--ticket', '71', '--body', 'ticket.md'], { cwd: root });
    expect(JSON.parse(result.out[0]!)).toMatchObject({ decisions: [{ id: 'enemy-style' }] });
  });

  it('refuses to raise an option without media and names it', async () => {
    const result = await gm(['decisions', 'raise', 'enemy-style'], { cwd: game() });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('Golems');
  });

  it('raises inventory options through gm decide as a non-blocking Command', async () => {
    const root = game();
    const inventoryFile = join(root, 'docs', basename(root), 'decisions.json');
    const inventory = structuredClone(data);
    const chatMedia = [];
    for (const [index, label] of ['Slimes', 'Golems'].entries()) {
      const image = join(root, `option-${index}.png`);
      writeFileSync(image, `image ${index}`);
      const posted = await gm(['chat', 'post', '--job', JOB_ID, '--text', label, '--image', image], { cwd: root });
      chatMedia.push(posted.out[0]!);
    }
    inventory[0]!.options = [
      { label: 'Slimes', media: `chat:${chatMedia[0]!}` },
      { label: 'Golems', media: `chat:${chatMedia[1]!}` },
    ];
    writeFileSync(inventoryFile, JSON.stringify(inventory));
    const result = await gm(['decisions', 'raise', 'enemy-style', '--json'], { cwd: root, env: { GM_JOB: JOB_ID } });
    expect(result.code, result.err.join('\n')).toBe(0);
    expect(JSON.parse(result.out[0]!).emit_event.payload).toMatchObject({
      blocking: false,
      recommendation: { reason: 'the pack includes a walk and attack sheet.' },
    });
    expect(JSON.parse(readFileSync(inventoryFile, 'utf8'))[0].status).toBe('asked');
    expect(JSON.parse(readFileSync(join(root, 'design', 'decisions.json'), 'utf8')).decisions).toHaveLength(1);
  });

  it('answers an inventory decision and records the timestamp', async () => {
    const root = game();
    const file = join(root, 'docs', basename(root), 'decisions.json');
    const inventory = structuredClone(data);
    inventory[0]!.options[1] = { label: 'Golems', media: 'chat:chat-golems' };
    writeFileSync(file, JSON.stringify(inventory));
    const unasked = await gm(['decisions', 'answer', 'enemy-style', 'Golems'], { cwd: root });
    expect(unasked.code).toBe(2);
    expect(unasked.err.join('\n')).toContain('has not been asked');
    inventory[0]!.status = 'asked';
    writeFileSync(file, JSON.stringify(inventory));
    const result = await gm(['decisions', 'answer', 'enemy-style', 'Golems', '--note', 'likes the darker look'], {
      cwd: root,
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8'))[0]).toMatchObject({
      status: 'answered',
      answer: 'Golems: likes the darker look',
    });
  });

  it('raises creator inventory decisions and stores the ledger command id', async () => {
    const root = game();
    const file = join(root, 'docs', basename(root), 'decisions.json');
    const inventory = structuredClone(data);
    for (const [index, label] of ['Slimes', 'Golems'].entries()) {
      const image = join(root, `raise-option-${index}.png`);
      writeFileSync(image, `image ${index}`);
      const posted = await gm(['chat', 'post', '--job', JOB_ID, '--text', label, '--image', image], { cwd: root });
      inventory[0]!.options[index] = { label, media: `chat:${posted.out[0]!}` };
    }
    writeFileSync(file, JSON.stringify(inventory));
    const raised = await gm(['decisions', 'raise', 'enemy-style', '--json'], { cwd: root, env: { GM_JOB: JOB_ID } });
    expect(raised.code, raised.err.join('\n')).toBe(0);
    expect(JSON.parse(raised.out[0]!).emit_event.payload.context.long_context_markdown).toContain(
      'gm-audience:creator',
    );
    expect(JSON.parse(raised.out[0]!).emit_event.payload.questions).toEqual([{ multi_select: true }]);
    expect(JSON.parse(readFileSync(file, 'utf8'))[0].command_id).toMatch(/^cp_/);
  });

  it('synchronizes note-only and multi-like review answers once, preserving the note text', () => {
    const inventory = structuredClone(data);
    inventory[0]!.status = 'asked';
    inventory[0]!.command_id = 'cp_01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const decision = (answers: unknown[], notes?: string, commandId = inventory[0]!.command_id) => ({
      decision_id: 'decision-1',
      question: inventory[0]!.question,
      decision_status: 'answered',
      context: { long_context_markdown: `<!-- gm-command:${commandId} -->` },
      answer: {
        custom_response: JSON.stringify({
          kind: 'question_answers',
          answers,
          ...(notes === undefined ? {} : { notes }),
        }),
      },
    });
    const multi = decision(
      [
        { option_id: 'golems', verdict: 'like', note: '  bigger  ' },
        { option_id: 'slimes', verdict: 'like' },
      ],
      'global note',
    );
    expect(syncInventory({ inventory, decisions: [multi], now: () => '2026-11-21T00:00:00.000Z' })).toBe(1);
    expect(inventory[0]).toMatchObject({
      status: 'answered',
      answer: 'Golems:   bigger  , Slimes: global note',
      answered_at: '2026-11-21T00:00:00.000Z',
    });
    expect(syncInventory({ inventory, decisions: [multi] })).toBe(0);

    const noteOnly = structuredClone(data);
    noteOnly[0]!.status = 'asked';
    noteOnly[0]!.command_id = 'cp_01ARZ3NDEKTSV4RRFFQ69G5FAV';
    expect(
      syncInventory({
        inventory: noteOnly,
        decisions: [decision([], 'Just the note', noteOnly[0]!.command_id!)],
        now: () => '2026-11-21T00:00:00.000Z',
      }),
    ).toBe(1);
    expect(noteOnly[0]!.answer).toBe('Just the note');

    const colonNote = structuredClone(data);
    colonNote[0]!.status = 'asked';
    colonNote[0]!.command_id = 'cp_01ARZ3NDEKTSV4RRFFQ69G5FAV';
    expect(
      syncInventory({
        inventory: colonNote,
        decisions: [decision([], 'Kevin: use the blue one', colonNote[0]!.command_id!)],
      }),
    ).toBe(1);
    expect(colonNote[0]!.answer).toBe('Kevin: use the blue one');
  });

  it('loads answered decisions from the local Aiur registry and writes inventory state', async () => {
    const root = game();
    const home = tempDir('gm-decisions-home-');
    mkdirSync(join(home, '.aiur'), { recursive: true });
    const token = join(home, '.aiur', 'token');
    writeFileSync(token, 'local-token');
    const file = join(root, 'docs', basename(root), 'decisions.json');
    const inventory = structuredClone(data);
    inventory[0]!.status = 'asked';
    inventory[0]!.command_id = 'cp_01ARZ3NDEKTSV4RRFFQ69G5FAV';
    inventory[0]!.options[1] = { label: 'Golems', media: 'chat-golems' };
    writeFileSync(file, JSON.stringify(inventory));
    writeFileSync(
      join(home, '.aiur', 'remote-instances.yaml'),
      `instances:\n  game:\n    url: http://127.0.0.1:43123\n    token_file: ${token}\n`,
    );
    const response = {
      decisions: [
        {
          decision_id: 'decision-1',
          version: 2,
          ticket: { identifier: 'OGM-1' },
          kind: 'direction_checkpoint',
          authority: 'supervisor_allowed',
          blocking: false,
          reversibility: 'reversible',
          question: 'Which enemies?',
          options: [],
          context: { long_context_markdown: '<!-- gm-command:cp_01ARZ3NDEKTSV4RRFFQ69G5FAV -->' },
          answer: {
            custom_response: JSON.stringify({
              kind: 'question_answers',
              answers: [{ option_id: 'golems', verdict: 'like', note: 'bigger' }],
              notes: 'Use these in the tower',
            }),
          },
          created_at: '2026-11-21T00:00:00.000Z',
          decision_status: 'answered',
        },
      ],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await gm(['decisions', 'sync'], { cwd: root, home });
    expect(result.code, result.err.join('\n')).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(readFileSync(file, 'utf8'))[0]).toMatchObject({
      status: 'answered',
      answer: 'Golems: bigger: Use these in the tower',
      answered_at: expect.any(String),
      command_id: null,
    });
  });

  it('synchronizes an inventory after a command was already submitted', async () => {
    const root = game();
    const file = join(root, 'docs', basename(root), 'decisions.json');
    const inventory = structuredClone(data);
    for (const [index, label] of ['Slimes', 'Golems'].entries()) {
      const image = join(root, `retry-option-${index}.png`);
      writeFileSync(image, `image ${index}`);
      const posted = await gm(['chat', 'post', '--job', JOB_ID, '--text', label, '--image', image], { cwd: root });
      inventory[0]!.options[index] = { label, media: `chat:${posted.out[0]!}` };
    }
    const mediaIds = inventory[0]!.options.map((option) => option.media!.slice('chat:'.length));
    const first = await gm(
      [
        'decide',
        '--topic',
        'Enemies choice',
        '--question',
        'Which enemies?',
        '--option',
        'slimes=Slimes',
        '--option',
        'golems=Golems',
        '--media',
        `slimes=${mediaIds[0]}`,
        '--media',
        `golems=${mediaIds[1]}`,
        '--recommend',
        'slimes',
        '--reason',
        'Fits the pack.',
        '--json',
      ],
      { cwd: root, env: { GM_JOB: JOB_ID } },
    );
    expect(first.code, first.err.join('\n')).toBe(0);
    writeFileSync(file, JSON.stringify(inventory));
    const retry = await gm(['decisions', 'raise', 'enemy-style', '--json'], { cwd: root, env: { GM_JOB: JOB_ID } });
    expect(retry.code, retry.err.join('\n')).toBe(0);
    expect(retry.out.join('\n')).toContain('already asked');
    expect(JSON.parse(readFileSync(file, 'utf8'))[0].status).toBe('asked');
  });

  it('gates creator-visible PR changes on a prototype review section', async () => {
    const root = game();
    const inventoryFile = join(root, 'docs', basename(root), 'decisions.json');
    const inventory = JSON.parse(JSON.stringify(data)) as Array<Record<string, unknown>>;
    for (const id of ['map-style', 'loot-style', 'inventory-ui'])
      inventory.push({
        ...inventory[0]!,
        id,
        status: 'answered',
        answer: 'Slimes',
        answered_at: '2026-01-01T00:00:00Z',
      });
    writeFileSync(inventoryFile, JSON.stringify(inventory));
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args]);
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'game.ts'), 'export const visible = true;\n');
    git('add', '-A');
    git('commit', '-qm', 'visible change');
    const body = join(root, 'pr.md');
    writeFileSync(body, 'Closes #71\n');
    const missing = await gm(['check', '--body', 'pr.md', '--base', 'origin/main'], { cwd: root });
    expect(missing.code).toBe(1);
    expect(missing.err.join('\n')).toContain('Prototype review');
    /* The waiver with a reason must pass here too, or publish accepts a body the PR gate rejects (#1250). */
    writeFileSync(body, 'Closes #71\n\nPrototype review: none (mock images only; no playable change)\n');
    const waived = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--json'], { cwd: root });
    expect(JSON.parse(waived.out[0]!).prototypeReview.problems).toEqual([]);
    writeFileSync(
      body,
      'Closes #71\n\n## Creator decisions\n- enemy-style\n\n## Prototype review\nPlay: https://example.test\nClip: clip.mp4\nWorks now: move.\nKnown limitations: none.\nWeigh in on: enemy-style, map-style, loot-style, inventory-ui.\n',
    );
    const open = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--json'], { cwd: root });
    expect(open.code).toBe(1);
    expect(JSON.parse(open.out[0]!).ok).toBe(false);
    expect(JSON.parse(open.out[0]!).prototypeReview.problems.join('\n')).toContain('enemy-style is still open');
    writeFileSync(
      body,
      'Closes #71\n\n## Prototype review\nPlay: https://example.test\nClip: clip.mp4\nWorks now: move.\nKnown limitations: none.\nWeigh in on: enemy-style, map-style, loot-style, inventory-ui.\n',
    );
    const reviewed = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--json'], { cwd: root });
    expect(JSON.parse(reviewed.out[0]!).prototypeReview.problems).toEqual([]);
    /* Kevin, #1278: a games-host play link throws the home-screen app out to the browser; reviews open the editor. */
    const review = (play: string) =>
      `Closes #71\n\n## Prototype review\nPlay: ${play}\nClip: clip.mp4\nWorks now: move.\nKnown limitations: none.\nWeigh in on: enemy-style, map-style, loot-style, inventory-ui.\n`;
    for (const hosted of [
      'https://host.example.ts.net:10000/g/g_1/build_1/',
      'https://games.example.test/g/g_1/build_1/',
    ]) {
      writeFileSync(body, review(hosted));
      const result = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--json'], { cwd: root });
      expect(result.code).toBe(1);
      expect(JSON.parse(result.out[0]!).prototypeReview.problems.join('\n')).toContain('Play links the games host');
    }
    writeFileSync(body, review('https://app.example.test/g/g_1?mode=edit'));
    const headOnly = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--json'], { cwd: root });
    expect(JSON.parse(headOnly.out[0]!).prototypeReview.problems.join('\n')).toContain('without the reviewed build');
    writeFileSync(body, review('https://app.example.test/g/g_1?mode=edit&build=build_1'));
    const inApp = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--json'], { cwd: root });
    expect(JSON.parse(inApp.out[0]!).prototypeReview.problems).toEqual([]);
  });

  it('reports unreadable review inputs as failed PR gate results', async () => {
    const root = game();
    const body = join(root, 'pr.md');
    writeFileSync(body, '## Creator decisions\n- enemy-style\n');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args]);
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'game.ts'), 'export const visible = true;\n');
    git('add', '-A');
    git('commit', '-qm', 'visible change');
    const inventoryFile = join(root, 'docs', basename(root), 'decisions.json');
    writeFileSync(inventoryFile, '{invalid');
    const invalidInventory = await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--json'], { cwd: root });
    expect(invalidInventory.code).toBe(1);
    expect(JSON.parse(invalidInventory.out[0]!).prototypeReview.problems.join('\n')).toContain(
      'invalid decision inventory',
    );
    const unreadableBody = await gm(['check', '--body', 'missing.md', '--base', 'origin/main', '--json'], {
      cwd: root,
    });
    expect(unreadableBody.code).toBe(1);
    expect(JSON.parse(unreadableBody.out[0]!).prototypeReview.problems[0]).toContain('cannot read PR body missing.md');
  });
});
