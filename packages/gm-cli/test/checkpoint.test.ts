import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AgentOutboxLine, playablesFromMarker } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

const JOB_ID = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';

function workspace(): string {
  const root = tempDir('gm-checkpoint-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

function checkpointLine(root: string) {
  const raw = readFileSync(join(root, '.gm', 'outbox', 'checkpoint.jsonl'), 'utf8').trim();
  return AgentOutboxLine.parse(JSON.parse(raw));
}

describe('gm checkpoint open', () => {
  it('writes two candidates with media and prints the correlated decision.requested call', async () => {
    const root = workspace();
    const events = join(root, 'events.jsonl');
    const post = await gm(['chat', 'post', '--job', JOB_ID, '--text', 'chunky preview'], { cwd: root });
    const mediaId = post.out[0];

    const result = await gm(
      [
        'checkpoint',
        'open',
        '--job',
        JOB_ID,
        '--question',
        'Which look?',
        '--option',
        'a=Chunky',
        '--option',
        'b=Flat',
        '--media',
        `a=${mediaId}`,
        '--recommend',
        'a',
        '--json',
      ],
      { cwd: root, env: { GM_EVENTS_FILE: events } },
    );

    expect(result).toMatchObject({ code: 0, err: [] });
    const printed = JSON.parse(result.out[0]) as {
      checkpoint_id: string;
      emit_event: { name: string; payload: Record<string, unknown> };
    };
    const line = checkpointLine(root);
    expect(printed.checkpoint_id).toMatch(/^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(line.payload).toMatchObject({
      checkpoint_id: printed.checkpoint_id,
      question: 'Which look?',
      options: [
        { id: 'a', label: 'Chunky', media_id: mediaId },
        { id: 'b', label: 'Flat' },
      ],
      recommend: 'a',
      blocking: true,
    });
    expect(printed.emit_event).toMatchObject({
      name: 'decision.requested',
      payload: {
        question: 'Which look?',
        blocking: true,
        kind: 'direction_checkpoint',
        authority: 'supervisor_allowed',
        reversibility: 'reversible',
        recommendation: { option_id: 'a' },
      },
    });
    expect((printed.emit_event.payload.context as { long_context_markdown: string }).long_context_markdown).toContain(
      `gm-checkpoint:${printed.checkpoint_id}`,
    );
    expect(JSON.parse(readFileSync(events, 'utf8'))).toMatchObject({
      event: 'checkpoint.open',
      job_id: JOB_ID,
      payload: { kind: 'direction_checkpoint' },
    });
  });

  it('prints the checkpoint id followed by copyable emit_event JSON by default', async () => {
    const result = await gm(
      [
        'checkpoint',
        'open',
        '--job',
        JOB_ID,
        '--question',
        'Which look?',
        '--option',
        'a=Chunky',
        '--option',
        'b=Flat',
      ],
      { cwd: workspace() },
    );
    expect(result.out[0]).toMatch(/^cp_/);
    expect(result.out[1]).toBe('Now call emit_event with this payload:');
    expect(JSON.parse(result.out[2])).toMatchObject({ name: 'decision.requested', message: 'Which look?' });
  });

  it('exits 2 for an unknown media id', async () => {
    const result = await gm(
      [
        'checkpoint',
        'open',
        '--job',
        JOB_ID,
        '--question',
        'Which look?',
        '--option',
        'a=Chunky',
        '--option',
        'b=Flat',
        '--media',
        'a=01JBX2R1A2B3C4D5E6F7G8H9JK',
      ],
      { cwd: workspace() },
    );
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('unknown chat message id');
  });

  // Gameplay-feel questions (#608) are answered by playing each option in the card, not by following a link.
  it('writes each option’s playable slice with its seconds, lead-in and branch', async () => {
    const root = workspace();
    const result = await gm(
      [
        'checkpoint',
        'open',
        '--job',
        JOB_ID,
        '--question',
        'Which fall speed?',
        '--option',
        'slow=Slow',
        '--option',
        'fast=Fast',
        '--playable',
        'slow=scenario=sandbox&speed=slow',
        '--playable',
        'fast=scenario=sandbox&speed=fast',
        '--seconds',
        'fast=5',
        '--lead-in',
        'slow=one-chain',
        '--branch',
        'feel',
        '--json',
      ],
      { cwd: root },
    );

    expect(result).toMatchObject({ code: 0, err: [] });
    // aiur's own copy of the Command says the options are played, not previews in the chat.
    const printed = JSON.parse(result.out[0]) as { emit_event: { payload: Record<string, unknown> } };
    expect(printed.emit_event.payload.options).toEqual([
      { id: 'slow', label: 'Slow', description: 'Play Slow for 8s' },
      { id: 'fast', label: 'Fast', description: 'Play Fast for 5s' },
    ]);
    expect(JSON.stringify(printed.emit_event.payload.context)).toContain('slices of the game');
    // The slices also ride in aiur's own copy, so the Command plays wherever it is read from.
    const context = printed.emit_event.payload.context as { long_context_markdown: string };
    expect([...playablesFromMarker(context.long_context_markdown).keys()]).toEqual(['slow', 'fast']);
    expect(checkpointLine(root).payload.options).toEqual([
      {
        id: 'slow',
        label: 'Slow',
        playable: { scenario: 'scenario=sandbox&speed=slow', seconds: 8, lead_in: 'one-chain', branch: 'feel' },
      },
      { id: 'fast', label: 'Fast', playable: { scenario: 'scenario=sandbox&speed=fast', seconds: 5, branch: 'feel' } },
    ]);
  });

  // A Blobs playtest is raised from an aiur workspace or the host (#639), where there is no build job. The Command
  // reaches the game's deck through aiur alone, so its slices must ride in the decision itself.
  it('raises a playable Command without a build job, carrying its slices in the decision', async () => {
    const root = workspace();
    const result = await gm(
      [
        'checkpoint',
        'open',
        '--question',
        'Which fall speed feels right?',
        '--option',
        'a=Slow',
        '--option',
        'b=Fast',
        '--option',
        'c=Neither',
        '--playable',
        'a=scenario=sandbox&speed=slow',
        '--playable',
        'b=scenario=sandbox&speed=fast',
        '--seconds',
        'a=20',
        '--json',
      ],
      { cwd: root },
    );

    expect(result).toMatchObject({ code: 0, err: [] });
    expect(existsSync(join(root, '.gm', 'outbox', 'checkpoint.jsonl'))).toBe(false);
    const printed = JSON.parse(result.out[0]) as {
      emit_event: { payload: { context: { long_context_markdown: string } } };
    };
    expect(Object.fromEntries(playablesFromMarker(printed.emit_event.payload.context.long_context_markdown))).toEqual({
      a: { scenario: 'scenario=sandbox&speed=slow', seconds: 20 },
      b: { scenario: 'scenario=sandbox&speed=fast', seconds: 8 },
    });
  });

  it('lets gm decide raise a titled playable Command without a build job', async () => {
    const root = workspace();
    const result = await gm(
      [
        'decide',
        '--topic',
        'Blobs fall speed',
        '--question',
        'Which fall speed feels right?',
        '--option',
        'a=Slow',
        '--option',
        'b=Fast',
        '--playable',
        'a=scenario=sandbox&speed=slow',
        '--playable',
        'b=scenario=sandbox&speed=fast',
        '--recommend',
        'a',
        '--reason',
        'Easier to read',
        '--json',
      ],
      { cwd: root },
    );

    expect(result).toMatchObject({ code: 0, err: [] });
    expect(existsSync(join(root, '.gm', 'outbox', 'checkpoint.jsonl'))).toBe(false);
    const printed = JSON.parse(result.out[0]) as {
      emit_event: { payload: { context: { short_summary: string; long_context_markdown: string } } };
    };
    expect(printed.emit_event.payload.context.short_summary).toBe('Blobs fall speed');
    expect([...playablesFromMarker(printed.emit_event.payload.context.long_context_markdown).keys()]).toEqual([
      'a',
      'b',
    ]);
  });

  it('exits 2 when the build workspace context names no job, instead of raising a job-less Command', async () => {
    const root = workspace();
    mkdirSync(join(root, '.gm', 'context'), { recursive: true });
    writeFileSync(join(root, '.gm', 'context', 'job.json'), '{}');
    const result = await gm(['checkpoint', 'open', '--question', 'Which?', '--option', 'a=A', '--option', 'b=B'], {
      cwd: root,
    });
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('has no job_id');
  });

  it('exits 2 for chat media without a build job', async () => {
    const result = await gm(
      ['checkpoint', 'open', '--question', 'Which?', '--option', 'a=A', '--option', 'b=B', '--media', 'a=m_1'],
      { cwd: workspace() },
    );
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('--media needs a build job');
  });

  it.each([
    { name: 'a URL scenario', extra: ['--playable', 'a=next=https://example.test/'], error: 'playable "a" is invalid' },
    { name: 'a host parameter', extra: ['--playable', 'a=build=published'], error: 'playable "a" is invalid' },
    { name: 'seconds without a playable', extra: ['--seconds', 'a=5'], error: 'has no --playable' },
    { name: 'a link in a label', extra: ['--option', 'c=See https://example.test/c'], error: 'must not contain links' },
    { name: 'a www link in a label', extra: ['--option', 'c=See www.example.test'], error: 'must not contain links' },
    { name: 'too few seconds', extra: ['--playable', 'a=speed=slow', '--seconds', 'a=1'], error: 'is invalid' },
    { name: 'too many seconds', extra: ['--playable', 'a=speed=slow', '--seconds', 'a=31'], error: 'is invalid' },
    { name: 'an unknown option', extra: ['--playable', 'z=speed=slow'], error: 'does not exist' },
    {
      name: 'a second playable',
      extra: ['--playable', 'a=speed=1', '--playable', 'a=speed=2'],
      error: 'more than one',
    },
  ])('exits 2 for $name', async ({ extra, error }) => {
    const result = await gm(
      ['checkpoint', 'open', '--job', JOB_ID, '--question', 'Which?', '--option', 'a=A', '--option', 'b=B', ...extra],
      { cwd: workspace() },
    );
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain(error);
  });

  it.each([
    { name: 'longer than one short line', question: 'x'.repeat(121), error: 'one line' },
    { name: 'over two lines', question: 'Which speed?\nMore context', error: 'one line' },
    { name: 'with a link', question: 'Which? https://example.test/play', error: 'must not contain links' },
  ])('exits 2 for a question $name', async ({ question, error }) => {
    const result = await gm(
      ['checkpoint', 'open', '--job', JOB_ID, '--question', question, '--option', 'a=A', '--option', 'b=B'],
      { cwd: workspace() },
    );
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain(error);
  });

  it('exits 2 when fewer than two options are provided', async () => {
    const result = await gm(
      ['checkpoint', 'open', '--job', JOB_ID, '--question', 'Which look?', '--option', 'a=Chunky'],
      { cwd: workspace() },
    );
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('2-5 options');
  });
});

describe('gm checkpoint wait', () => {
  it('prints the selected option from an answered inbox file', async () => {
    const root = workspace();
    const inbox = join(root, '.gm', 'inbox', 'checkpoints');
    mkdirSync(inbox, { recursive: true });
    writeFileSync(
      join(inbox, 'cp_demo.json'),
      JSON.stringify({
        checkpoint_id: 'cp_demo',
        decision_id: 'decision_demo',
        option_id: 'b',
        status: 'answered',
        at: new Date().toISOString(),
      }),
    );

    expect(await gm(['checkpoint', 'wait', 'cp_demo', '--timeout', '1'], { cwd: root })).toEqual({
      code: 0,
      out: ['b'],
      err: [],
    });
  });

  it('exits 3 after the timeout', async () => {
    const result = await gm(['checkpoint', 'wait', 'cp_missing', '--timeout', '1'], { cwd: workspace() });
    expect(result.code).toBe(3);
    expect(result.err).toEqual(['no answer after 1 s; make sure the emit_event call was made']);
  });

  it('exits 4 when the checkpoint is moot', async () => {
    const root = workspace();
    const inbox = join(root, '.gm', 'inbox', 'checkpoints');
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, 'decision_demo.json'), JSON.stringify({ status: 'moot' }));
    expect(await gm(['checkpoint', 'wait', 'decision_demo', '--timeout', '1'], { cwd: root })).toEqual({
      code: 4,
      out: [],
      err: ['checkpoint is moot'],
    });
  });

  it('exits 1 instead of waiting when the inbox path cannot be read', async () => {
    const root = workspace();
    const unreadable = join(root, '.gm', 'inbox', 'checkpoints', 'cp_unreadable.json');
    mkdirSync(unreadable, { recursive: true });

    const result = await gm(['checkpoint', 'wait', 'cp_unreadable', '--timeout', '1'], { cwd: root });

    expect(result.code).toBe(1);
    expect(result.err[0]).toContain(`cannot read ${unreadable}`);
  });
});
