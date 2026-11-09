import { CREATOR_AUDIENCE_MARKER, CREATOR_TEXT_ONLY_MARKER } from '@ogm/contracts';
import { ulid } from 'ulid';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { alreadyAsked, appendDecision, DECISIONS_FILE, readDecisions } from '../../ledger/decisions.js';
import { strings } from '../../ledger/provenance.js';
import { gameDir } from '../../outbox.js';
import { MAX_QUESTION, pair, URL_TEXT } from '../checkpoint/open.js';

function text(flags: Record<string, unknown>, name: string): string {
  const value = flags[name];
  return typeof value === 'string' ? value.trim() : '';
}

// A product question (#612): words only, about rules, scope or audience. It is never shown to the creator one by one;
// it waits in the game's queue and the inbox offers a quick voice chat once enough are queued. A look, sound or feel
// question is not a product question: ask it with `gm decide`, which puts the thing itself on every option.
export const command: GmCommand = {
  name: 'ask',
  summary: 'queue a words-only product question for the creator and print the decision.requested tool call',
  usage: '--topic <2-5 words> --question <q> --option <id>=<label> ... --recommend <id> --reason <why>',
  example:
    'ask --topic "Lives per run" --question "How many lives does the hero get?" --option one=One --option three=Three --recommend three --reason "Levels are long"',
  flags: {
    topic: { type: 'string', help: '2-5 word title; related questions share one' },
    question: { type: 'string', help: 'the question, in plain words, one line' },
    option: { type: 'string', multiple: true, help: 'option id and label; repeat 2-5 times' },
    recommend: { type: 'string', help: 'option id you recommend' },
    reason: { type: 'string', help: 'one line: why the recommended option' },
    revisit: { type: 'boolean', default: false, help: 'ask a recorded question again because the creator reopened it' },
  },
  async run(ctx, _args, flags) {
    const topic = text(flags, 'topic');
    const words = topic.split(/\s+/).filter(Boolean).length;
    if (words < 2 || words > 5 || topic.length > 80)
      throw new UsageError('--topic needs 2-5 words', 'gm ask --topic "Lives per run" ...');
    const question = text(flags, 'question');
    if (!question || question.length > MAX_QUESTION || /[\r\n]/.test(question))
      throw new UsageError(`--question must be one line of at most ${MAX_QUESTION} characters`, 'shorten the question');
    const options = strings(flags, 'option').map((raw) => {
      const [id, label] = pair(raw, 'option', 'gm help ask');
      return { id, label };
    });
    // A voice agent reads every option aloud, so the set stays short.
    if (options.length < 2 || options.length > 5)
      throw new UsageError('ask needs 2-5 options', 'repeat --option <id>=<label> 2-5 times');
    if (new Set(options.map(({ id }) => id)).size !== options.length)
      throw new UsageError('option ids must be unique', 'use a different id for each --option');
    if (URL_TEXT.test(question) || options.some(({ label }) => URL_TEXT.test(label)))
      throw new UsageError('the question and labels must not contain links', 'say it in plain words');
    const recommend = text(flags, 'recommend');
    if (!options.some(({ id }) => id === recommend))
      throw new UsageError('--recommend must name one of the --option ids', 'gm ask ... --recommend <id>');
    const reason = text(flags, 'reason');
    if (!reason || reason.length > 500)
      throw new UsageError('--reason is required, one line of at most 500 characters', 'say in one line why');

    const dir = gameDir(ctx.cwd);
    const earlier = alreadyAsked(readDecisions(dir), topic, question);
    if (earlier && flags.revisit !== true)
      throw new UsageError(
        `"${earlier.question}" was already asked under "${earlier.topic}" (${earlier.command}) and is in ${DECISIONS_FILE}`,
        'its answer is in the decision record once given; pass --revisit only when the creator reopened it',
      );
    // The record keys every question by a checkpoint-shaped id; a product question has no checkpoint, so it gets its own.
    const id = `cp_${ulid()}`;
    appendDecision(dir, {
      command: id,
      topic,
      question,
      options: options.map(({ id: optionId }) => optionId),
      recommend,
      at: new Date().toISOString(),
      ...(earlier ? { revisits: earlier.command } : {}),
    });

    const emitEvent = {
      name: 'decision.requested',
      message: question,
      payload: {
        question,
        // Raised blocking like `gm decide`: aiur retires a non-blocking Command once its ticket has no running agent
        // (until aiur #7872 is deployed), and a queued question must wait for its voice session.
        blocking: true,
        kind: 'direction_checkpoint',
        authority: 'supervisor_allowed',
        reversibility: 'reversible',
        urgency: 'normal',
        context: {
          short_summary: topic,
          long_context_markdown: `${CREATOR_AUDIENCE_MARKER}\n${CREATOR_TEXT_ONLY_MARKER}\nA product question for the creator's next quick voice chat.`,
        },
        options: options.map(({ id: optionId, label }) => ({ id: optionId, label, description: label })),
        recommendation: { option_id: recommend, reason },
        consequence_of_delay: 'Independent work continues; the dependent step waits for the answer.',
      },
    };
    if (ctx.json) ctx.out(JSON.stringify({ id, emit_event: emitEvent }));
    else {
      ctx.out('Now call emit_event with this payload:');
      ctx.out(JSON.stringify(emitEvent, null, 2));
    }
    return EXIT.ok;
  },
};
