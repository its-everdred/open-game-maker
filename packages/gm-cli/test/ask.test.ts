import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CREATOR_AUDIENCE_MARKER, CREATOR_TEXT_ONLY_MARKER } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

function workspace(): string {
  const root = tempDir('gm-ask-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

function ask(root: string, extra: string[] = [], options = ['one=One', 'three=Three']) {
  return gm(
    [
      'ask',
      '--topic',
      'Lives per run',
      '--question',
      'How many lives does the hero get?',
      ...options.flatMap((option) => ['--option', option]),
      '--recommend',
      'three',
      '--reason',
      'Levels are long',
      ...extra,
      '--json',
    ],
    { cwd: root },
  );
}

describe('gm ask', () => {
  // The server queues a Command for a voice session only when it carries both markers (#612): without the text-only
  // marker it would show in the deck as a words-only option set, which the creator must never see.
  it('marks the question for the creator and as text-only, and records it', async () => {
    const root = workspace();
    const result = await ask(root);
    expect(result.code).toBe(0);
    const { id, emit_event } = JSON.parse(result.out[0]!) as {
      id: string;
      emit_event: {
        payload: { context: { short_summary: string; long_context_markdown: string }; options: unknown[] };
      };
    };
    const context = emit_event.payload.context;
    expect(context.long_context_markdown).toContain(CREATOR_AUDIENCE_MARKER);
    expect(context.long_context_markdown).toContain(CREATOR_TEXT_ONLY_MARKER);
    // No checkpoint marker: the Command is mirrored as a plain decision, not matched to an outbox row.
    expect(context.long_context_markdown).not.toContain('gm-checkpoint:');
    expect(context.short_summary).toBe('Lives per run');
    expect(emit_event.payload.options).toHaveLength(2);
    const record = JSON.parse(readFileSync(join(root, 'design', 'decisions.json'), 'utf8')) as {
      decisions: Array<{ command: string; topic: string }>;
    };
    expect(record.decisions).toEqual([expect.objectContaining({ command: id, topic: 'Lives per run' })]);
  });

  it('refuses a question already asked unless the creator reopened it', async () => {
    const root = workspace();
    expect((await ask(root)).code).toBe(0);
    const again = await ask(root);
    expect(again.code).not.toBe(0);
    expect(again.err.join('\n')).toContain('already asked');
    expect((await ask(root, ['--revisit'])).code).toBe(0);
  });

  it('refuses a recommendation that is not an option and a set the voice agent cannot read out', async () => {
    const root = workspace();
    const unknown = await gm(
      [
        'ask',
        '--topic',
        'Lives per run',
        '--question',
        'How many?',
        '--option',
        'a=A',
        '--option',
        'b=B',
        '--recommend',
        'c',
        '--reason',
        'r',
      ],
      { cwd: root },
    );
    expect(unknown.code).not.toBe(0);
    const six = await ask(root, [], ['a=A', 'b=B', 'c=C', 'd=D', 'e=E', 'three=Three']);
    expect(six.code).not.toBe(0);
  });
});
