import { AgentOutboxLine } from '@ogm/contracts';
import { ulid } from 'ulid';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { checkOptions, readLedger } from '../../ledger/index.js';
import { provenancePairs, strings } from '../../ledger/provenance.js';
import { appendOutboxLine, gameDir, jobContext, knownChatMessageIds } from '../../outbox.js';

const OPTION_ID = /^[a-z0-9_-]{1,32}$/;

export type CheckpointOpenPayload = {
  checkpoint_id: `cp_${string}`;
  question: string;
  options: { id: string; label: string; media_id?: string; provenance?: unknown }[];
  recommend?: string;
  blocking: boolean;
};

type EmitEventCall = {
  name: 'decision.requested';
  message: string;
  payload: Record<string, unknown>;
};

function pair(raw: string, flag: string): [string, string] {
  const separator = raw.indexOf('=');
  const id = raw.slice(0, separator).trim();
  const value = separator < 0 ? '' : raw.slice(separator + 1).trim();
  if (!OPTION_ID.test(id) || !value)
    throw new UsageError(`--${flag} needs id=value with id matching [a-z0-9_-]{1,32}`, `gm help checkpoint open`);
  return [id, value];
}

export function buildEmitEvent(payload: CheckpointOpenPayload): EmitEventCall {
  return {
    name: 'decision.requested',
    message: payload.question,
    payload: {
      question: payload.question,
      blocking: payload.blocking,
      kind: 'direction_checkpoint',
      authority: 'supervisor_allowed',
      reversibility: 'reversible',
      urgency: 'normal',
      context: {
        short_summary: 'Direction checkpoint for the creator',
        long_context_markdown: `<!-- gm-checkpoint:${payload.checkpoint_id} -->\nOptions are previews already posted in the build chat.`,
      },
      options: payload.options.map(({ id, label }) => ({ id, label, description: `Preview ${label}` })),
      ...(payload.recommend
        ? {
            recommendation: {
              option_id: payload.recommend,
              reason: 'Closest to the current build direction.',
            },
          }
        : {}),
      consequence_of_delay: 'Independent work continues; the dependent step waits for the answer.',
    },
  };
}

export const command: GmCommand = {
  name: 'checkpoint open',
  summary: 'write preview choices and print the decision.requested tool call',
  usage: '--question <q> --option <id>=<label> --option <id>=<label> [options]',
  example: 'checkpoint open --question "Which look?" --option a=Chunky --option b=Flat --recommend a',
  flags: {
    job: { type: 'string', help: 'build job id (defaults to GM_JOB, then .gm/context/job.json)' },
    question: { type: 'string', help: 'bounded direction question for the creator' },
    option: { type: 'string', multiple: true, help: 'candidate id and label; repeat 2-5 times' },
    media: { type: 'string', multiple: true, help: 'option id and prior chat message id; repeat as needed' },
    provenance: {
      type: 'string',
      multiple: true,
      help: 'option id and its provenance JSON or @file; repeat once per option',
    },
    recommend: { type: 'string', help: 'option id recommended by the builder' },
    blocking: { type: 'boolean', default: false, help: 'hold this worker until the creator answers' },
  },
  async run(ctx, _args, flags) {
    const question = typeof flags.question === 'string' ? flags.question.trim() : '';
    if (!question) throw new UsageError('--question is required', 'gm checkpoint open --question "<question>"');
    if (question.length > 2000) throw new UsageError('--question exceeds 2000 characters', 'shorten the question');
    const optionPairs = strings(flags, 'option').map((value) => pair(value, 'option'));
    if (optionPairs.length < 2 || optionPairs.length > 5)
      throw new UsageError('checkpoint needs 2-5 options', 'repeat --option <id>=<label> 2-5 times');
    const ids = optionPairs.map(([id]) => id);
    if (new Set(ids).size !== ids.length)
      throw new UsageError('option ids must be unique', 'use a different id for each --option');

    const recommend = typeof flags.recommend === 'string' ? flags.recommend.trim() : undefined;
    if (recommend && !ids.includes(recommend))
      throw new UsageError(`recommended option "${recommend}" does not exist`, 'recommend one of the --option ids');

    const { root, jobId } = jobContext({
      cwd: ctx.cwd,
      job: typeof flags.job === 'string' ? flags.job : undefined,
      environmentJob: ctx.config.jobId,
    });
    const knownMedia = knownChatMessageIds(root, jobId);
    const media = new Map<string, string>();
    for (const raw of strings(flags, 'media')) {
      const [optionId, messageId] = pair(raw, 'media');
      if (!ids.includes(optionId))
        throw new UsageError(`media option "${optionId}" does not exist`, 'use an id from --option');
      if (!knownMedia.has(messageId))
        throw new UsageError(`unknown chat message id "${messageId}"`, 'run gm chat post before checkpoint open');
      if (media.has(optionId))
        throw new UsageError(`option "${optionId}" has more than one media id`, 'pass one --media per option');
      media.set(optionId, messageId);
    }

    const provenance = provenancePairs(flags, root);
    for (const id of provenance.keys()) {
      if (!ids.includes(id)) throw new UsageError(`provenance names unknown option "${id}"`, 'use an id from --option');
    }

    const checkpointId = `cp_${ulid()}` as const;
    const options = optionPairs.map(([id, label]) => ({
      id,
      label,
      ...(media.has(id) ? { media_id: media.get(id)! } : {}),
      ...(provenance.has(id) ? { provenance: provenance.get(id)! } : {}),
    }));
    // The ledger gate: an option the game's rejections already invalidated never reaches the creator.
    const verdict = checkOptions(
      options.map((option) => ({ ...option, command: checkpointId })),
      readLedger(gameDir(ctx.cwd, root)),
    );
    if (!verdict.ok) {
      for (const violation of verdict.violations)
        ctx.err(`${violation.kind} ${violation.option_id}: ${violation.detail}`);
      throw new UsageError(
        'refused to open a checkpoint with an option the feedback ledger rejects',
        'gm options check --option <id>=<label> to see the violations',
      );
    }

    const payload: CheckpointOpenPayload = {
      checkpoint_id: checkpointId,
      question,
      options,
      ...(recommend ? { recommend } : {}),
      blocking: flags.blocking === true,
    };
    const line = AgentOutboxLine.parse({
      v: 1,
      id: ulid(),
      job_id: jobId,
      at: new Date().toISOString(),
      type: 'checkpoint.open',
      payload,
    });
    appendOutboxLine(root, 'checkpoint.jsonl', line);
    ctx.emit('checkpoint.open', { kind: 'direction_checkpoint' }, jobId);
    const emitEvent = buildEmitEvent(payload);
    if (ctx.json) ctx.out(JSON.stringify({ checkpoint_id: payload.checkpoint_id, emit_event: emitEvent }));
    else {
      ctx.out(payload.checkpoint_id);
      ctx.out('Now call emit_event with this payload:');
      ctx.out(JSON.stringify(emitEvent, null, 2));
    }
    return EXIT.ok;
  },
};
