import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AgentOutboxLine, CREATOR_AUDIENCE_MARKER } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

const JOB_ID = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';

function workspace(): string {
  const root = tempDir('gm-decide-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

async function media(root: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const image = join(root, `preview-${index}.png`);
    writeFileSync(image, `preview ${index}`);
    const post = await gm(['chat', 'post', '--job', JOB_ID, '--text', `preview ${index}`, '--image', image], {
      cwd: root,
    });
    ids.push(post.out[0]!);
  }
  return ids;
}

function outboxLines(root: string) {
  const file = join(root, '.gm', 'outbox', 'checkpoint.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((raw) => AgentOutboxLine.parse(JSON.parse(raw)));
}

function record(root: string) {
  return JSON.parse(readFileSync(join(root, 'design', 'decisions.json'), 'utf8')) as {
    decisions: Array<{ command: string; topic: string; recommend: string; revisits?: string }>;
  };
}

async function decide(
  root: string,
  ids: string[],
  extra: string[] = [],
  topic = 'Hero jump feel',
  question = 'How should the hero jump?',
) {
  const options = ids.flatMap((id, index) => ['--option', `o${index}=Option ${index}`, '--media', `o${index}=${id}`]);
  return gm(
    [
      'decide',
      '--job',
      JOB_ID,
      '--topic',
      topic,
      '--question',
      question,
      ...options,
      '--recommend',
      'o0',
      '--reason',
      'The tower is vertical',
      ...extra,
      '--json',
    ],
    { cwd: root },
  );
}

describe('gm decide', () => {
  it('asks with as many options as the question needs and titles the Command with its topic', async () => {
    const root = workspace();
    // Six voices: more than the old fixed 2-5, so the option count follows the question.
    const result = await decide(root, await media(root, 6));

    expect(result).toMatchObject({ code: 0, err: [] });
    const printed = JSON.parse(result.out[0]!) as {
      checkpoint_id: string;
      emit_event: { name: string; payload: Record<string, any> };
    };
    expect(printed.emit_event.name).toBe('decision.requested');
    expect(printed.emit_event.payload.context.short_summary).toBe('Hero jump feel');
    // The marker is what puts the Command in the creator's inbox rather than the Executor's.
    expect(printed.emit_event.payload.context.long_context_markdown).toContain(CREATOR_AUDIENCE_MARKER);
    expect(printed.emit_event.payload.recommendation).toEqual({ option_id: 'o0', reason: 'The tower is vertical' });
    expect(printed.emit_event.payload.options).toHaveLength(6);

    const [line] = outboxLines(root);
    expect(line!.payload).toMatchObject({ checkpoint_id: printed.checkpoint_id, topic: 'Hero jump feel' });
    expect(record(root).decisions).toEqual([
      expect.objectContaining({ command: printed.checkpoint_id, topic: 'Hero jump feel', recommend: 'o0' }),
    ]);
  });

  it('never asks a recorded question again unless the creator reopened it', async () => {
    const root = workspace();
    const ids = await media(root, 2);
    const first = await decide(root, ids);
    const firstId = (JSON.parse(first.out[0]!) as { checkpoint_id: string }).checkpoint_id;

    // Case and spacing do not make a new topic or question.
    const again = await decide(root, ids, [], 'hero  JUMP feel', 'how should the  hero jump?');
    expect(again.code).toBe(2);
    expect(again.err.join('\n')).toContain(`already asked under "Hero jump feel" (${firstId})`);
    expect(outboxLines(root)).toHaveLength(1);

    const reopened = await decide(root, ids, ['--revisit']);
    expect(reopened.code).toBe(0);
    expect(outboxLines(root)).toHaveLength(2);
    expect(record(root).decisions[1]).toMatchObject({ topic: 'Hero jump feel', revisits: firstId });
  });

  it('lets related questions share a topic', async () => {
    const root = workspace();
    const ids = await media(root, 2);
    expect((await decide(root, ids)).code).toBe(0);

    const related = await decide(root, ids, [], 'Hero jump feel', 'How high should the hero jump?');
    expect(related.code).toBe(0);
    expect(outboxLines(root).map((line) => (line.payload as { topic?: string }).topic)).toEqual([
      'Hero jump feel',
      'Hero jump feel',
    ]);
    expect(record(root).decisions).toHaveLength(2);
  });

  it('stops before asking when the decision record cannot be read', async () => {
    const root = workspace();
    const ids = await media(root, 2);
    mkdirSync(join(root, 'design'), { recursive: true });
    writeFileSync(join(root, 'design', 'decisions.json'), '{ not json');

    const result = await decide(root, ids);
    expect(result.code).not.toBe(0);
    expect(result.err.join('\n')).toContain('design/decisions.json is not valid JSON');
    expect(outboxLines(root)).toHaveLength(0);
  });

  it('refuses a topic that is not two to five words', async () => {
    const root = workspace();
    const ids = await media(root, 2);
    for (const topic of ['Jump', 'How high and how floaty should the jump be']) {
      const result = await decide(root, ids, [], topic);
      expect(result.code).toBe(2);
      expect(result.err.join('\n')).toContain('--topic needs 2-5 words');
    }
    expect(outboxLines(root)).toHaveLength(0);
  });

  it('refuses an option the creator cannot see or hear', async () => {
    const root = workspace();
    const [only] = await media(root, 1);
    const result = await gm(
      [
        'decide',
        '--job',
        JOB_ID,
        '--topic',
        'Hero jump feel',
        '--question',
        'How should the hero jump?',
        '--option',
        'a=Tight',
        '--option',
        'b=Floaty',
        '--media',
        `a=${only}`,
        '--recommend',
        'a',
        '--reason',
        'The tower is vertical',
      ],
      { cwd: root },
    );

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('option "b" has no media');
    expect(outboxLines(root)).toHaveLength(0);
    expect(existsSync(join(root, 'design', 'decisions.json'))).toBe(false);
  });

  it("refuses a text-only post as an option's media", async () => {
    const root = workspace();
    const [image] = await media(root, 1);
    const text = (await gm(['chat', 'post', '--job', JOB_ID, '--text', 'a floaty jump'], { cwd: root })).out[0]!;
    const result = await gm(
      [
        'decide',
        '--job',
        JOB_ID,
        '--topic',
        'Hero jump feel',
        '--question',
        'How should the hero jump?',
        '--option',
        'a=Tight',
        '--option',
        'b=Floaty',
        '--media',
        `a=${image}`,
        '--media',
        `b=${text}`,
        '--recommend',
        'a',
        '--reason',
        'The tower is vertical',
      ],
      { cwd: root },
    );

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('media for option "b" is a text post');
    expect(outboxLines(root)).toHaveLength(0);
  });

  it('accepts a playable slice as the thing the creator tries on an option', async () => {
    const root = workspace();
    const [only] = await media(root, 1);
    const result = await gm(
      [
        'decide',
        '--job',
        JOB_ID,
        '--topic',
        'Hero jump feel',
        '--question',
        'How should the hero jump?',
        '--option',
        'a=Tight',
        '--option',
        'b=Floaty',
        '--media',
        `a=${only}`,
        '--playable',
        'b=scenario=sandbox&jump=floaty',
        '--recommend',
        'a',
        '--reason',
        'The tower is vertical',
      ],
      { cwd: root },
    );

    expect(result.code).toBe(0);
    const [line] = outboxLines(root);
    expect(line?.payload).toMatchObject({
      options: [{ id: 'a' }, { id: 'b', playable: { scenario: 'scenario=sandbox&jump=floaty' } }],
    });
  });

  it('refuses a question without a recommendation and its reason', async () => {
    const root = workspace();
    const ids = await media(root, 2);
    const options = ['--option', `a=Tight`, '--media', `a=${ids[0]}`, '--option', 'b=Floaty', '--media', `b=${ids[1]}`];
    const base = ['decide', '--job', JOB_ID, '--topic', 'Hero jump feel', '--question', 'How?', ...options];

    const noRecommend = await gm([...base, '--reason', 'Vertical tower'], { cwd: root });
    expect(noRecommend.code).toBe(2);
    expect(noRecommend.err.join('\n')).toContain('--recommend is required');

    const noReason = await gm([...base, '--recommend', 'a'], { cwd: root });
    expect(noReason.code).toBe(2);
    expect(noReason.err.join('\n')).toContain('--reason is required');
  });
});
