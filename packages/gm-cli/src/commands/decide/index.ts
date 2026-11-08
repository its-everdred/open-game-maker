import { MAX_COMMAND_OPTIONS } from '@ogm/contracts';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { alreadyAsked, appendDecision, DECISIONS_FILE, readDecisions } from '../../ledger/decisions.js';
import { gameDir } from '../../outbox.js';
import { openCheckpoint, printEmitEvent } from '../checkpoint/open.js';

function text(flags: Record<string, unknown>, name: string): string {
  const value = flags[name];
  return typeof value === 'string' ? value.trim() : '';
}

// A topic is the Command's title in the creator's inbox and modal: two to five plain words.
function wordCount(topic: string): number {
  return topic.split(/\s+/).filter(Boolean).length;
}

export const command: GmCommand = {
  name: 'decide',
  summary: 'ask the creator a product question and print the decision.requested tool call',
  usage:
    '--topic <2-5 words> --question <q> --option <id>=<label> --media <id>=<chat-message-id> ... --recommend <id> --reason <why>',
  example:
    'decide --topic "Hero jump feel" --question "How should the hero jump?" --option a=Tight --option b=Floaty --media a=<msg> --media b=<msg> --recommend a --reason "The tower is vertical"',
  flags: {
    job: { type: 'string', help: 'build job id (defaults to GM_JOB, then .gm/context/job.json)' },
    topic: { type: 'string', help: '2-5 word title for the inbox; related questions share one' },
    question: { type: 'string', help: 'the player-facing question, in plain words' },
    option: {
      type: 'string',
      multiple: true,
      help: `candidate id and label; as many as the question needs (2-${MAX_COMMAND_OPTIONS})`,
    },
    media: {
      type: 'string',
      multiple: true,
      help: 'option id and its chat message id; one per option (or --playable)',
    },
    provenance: {
      type: 'string',
      multiple: true,
      help: 'option id and its provenance JSON or @file; repeat once per option',
    },
    playable: {
      type: 'string',
      multiple: true,
      help: 'option id and the scenario query its playable slice runs; counts as its media',
    },
    seconds: { type: 'string', multiple: true, help: 'option id and how long its slice plays (2-30, default 8)' },
    'lead-in': { type: 'string', multiple: true, help: 'option id and the scripted move its slice plays first' },
    branch: { type: 'string', help: 'game branch whose build the playable slices run (defaults to main)' },
    recommend: { type: 'string', help: 'option id you recommend' },
    reason: { type: 'string', help: 'one line: why the recommended option' },
    revisit: { type: 'boolean', default: false, help: 'ask a recorded question again because the creator reopened it' },
    blocking: { type: 'boolean', default: false, help: 'hold this worker until the creator answers' },
  },
  async run(ctx, _args, flags) {
    const topic = text(flags, 'topic');
    const words = wordCount(topic);
    if (words < 2 || words > 5 || topic.length > 80)
      throw new UsageError('--topic needs 2-5 words', 'gm decide --topic "Hero jump feel" ...');
    if (!text(flags, 'recommend'))
      throw new UsageError('--recommend is required', 'name the option you would pick with --recommend <id>');
    const reason = text(flags, 'reason');
    if (!reason) throw new UsageError('--reason is required', 'say in one line why with --reason "<why>"');
    if (reason.length > 500) throw new UsageError('--reason exceeds 500 characters', 'keep the reason to one line');

    // No duplicates: a question already put to the creator is open or settled, so it is not asked again unless they
    // reopened it. Related questions share a topic, so a new question under a recorded topic is fine.
    const dir = gameDir(ctx.cwd);
    const earlier = alreadyAsked(readDecisions(dir), topic, text(flags, 'question'));
    if (earlier && flags.revisit !== true)
      throw new UsageError(
        `"${earlier.question}" was already asked under "${earlier.topic}" (${earlier.command}) and is in ${DECISIONS_FILE}`,
        `use its answer (gm checkpoint wait ${earlier.command}); pass --revisit only when the creator reopened it`,
      );

    const payload = openCheckpoint(ctx, flags, {
      name: 'decide',
      maxOptions: MAX_COMMAND_OPTIONS,
      mediaOnEveryOption: true,
      topic,
    });
    appendDecision(dir, {
      command: payload.checkpoint_id,
      topic,
      question: payload.question,
      options: payload.options.map(({ id }) => id),
      recommend: payload.recommend!,
      at: new Date().toISOString(),
      ...(earlier ? { revisits: earlier.command } : {}),
    });
    printEmitEvent(ctx, payload, { topic, reason });
    return EXIT.ok;
  },
};
