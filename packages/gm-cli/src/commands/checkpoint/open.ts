import { AgentOutboxLine, OptionPlayable } from '@ogm/contracts';
import { ulid } from 'ulid';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { checkOptions, readLedger } from '../../ledger/index.js';
import { provenancePairs, strings } from '../../ledger/provenance.js';
import { appendOutboxLine, gameDir, jobContext, knownChatMessageIds } from '../../outbox.js';

const OPTION_ID = /^[a-z0-9_-]{1,32}$/;
// The deck shows the question as one short line and never shows a link (#608): a gameplay question carries a playable
// slice instead of a URL to go and try.
const MAX_QUESTION = 120;
const URL_TEXT = /[a-z][a-z0-9+.-]*:\/\/|\bwww\./i;

export type CheckpointOpenPayload = {
  checkpoint_id: `cp_${string}`;
  question: string;
  options: { id: string; label: string; media_id?: string; provenance?: unknown; playable?: OptionPlayable }[];
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
        long_context_markdown: `<!-- gm-checkpoint:${payload.checkpoint_id} -->\n${
          payload.options.some(({ playable }) => playable)
            ? 'Options are slices of the game the creator plays in the review deck.'
            : 'Options are previews already posted in the build chat.'
        }`,
      },
      options: payload.options.map(({ id, label, playable }) => ({
        id,
        label,
        description: playable ? `Play ${label} for ${playable.seconds}s` : `Preview ${label}`,
      })),
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
    playable: {
      type: 'string',
      multiple: true,
      help: 'option id and the scenario query its playable slice runs, e.g. a=scenario=sandbox&speed=slow',
    },
    seconds: { type: 'string', multiple: true, help: 'option id and how long its slice plays (2-30, default 8)' },
    'lead-in': { type: 'string', multiple: true, help: 'option id and the scripted move its slice plays first' },
    branch: { type: 'string', help: 'game branch whose build the playable slices run (defaults to main)' },
    recommend: { type: 'string', help: 'option id recommended by the builder' },
    blocking: { type: 'boolean', default: false, help: 'hold this worker until the creator answers' },
  },
  async run(ctx, _args, flags) {
    const question = typeof flags.question === 'string' ? flags.question.trim() : '';
    if (!question) throw new UsageError('--question is required', 'gm checkpoint open --question "<question>"');
    if (question.length > MAX_QUESTION || /[\r\n]/.test(question))
      throw new UsageError(`--question must be one line of at most ${MAX_QUESTION} characters`, 'shorten the question');
    const optionPairs = strings(flags, 'option').map((value) => pair(value, 'option'));
    if (optionPairs.length < 2 || optionPairs.length > 5)
      throw new UsageError('checkpoint needs 2-5 options', 'repeat --option <id>=<label> 2-5 times');
    const ids = optionPairs.map(([id]) => id);
    if (URL_TEXT.test(question) || optionPairs.some(([, label]) => URL_TEXT.test(label)))
      throw new UsageError(
        'the question and labels must not contain links',
        'use --playable to let the creator try it',
      );
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

    const playables = playablePairs(flags, ids);

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
      ...(playables.has(id) ? { playable: playables.get(id)! } : {}),
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

// `--playable <id>=<scenario>` with its optional `--seconds` and `--lead-in` per option, and one `--branch` for all.
function playablePairs(flags: Record<string, unknown>, ids: readonly string[]): Map<string, OptionPlayable> {
  const known = (raw: string, flag: string): [string, string] => {
    const [id, value] = pair(raw, flag);
    if (!ids.includes(id)) throw new UsageError(`${flag} option "${id}" does not exist`, 'use an id from --option');
    return [id, value];
  };
  const scenarios = new Map(strings(flags, 'playable').map((raw) => known(raw, 'playable')));
  if (scenarios.size !== strings(flags, 'playable').length)
    throw new UsageError('an option has more than one --playable', 'pass one --playable per option');
  const seconds = new Map(strings(flags, 'seconds').map((raw) => known(raw, 'seconds')));
  const leadIns = new Map(strings(flags, 'lead-in').map((raw) => known(raw, 'lead-in')));
  for (const id of [...seconds.keys(), ...leadIns.keys()]) {
    if (!scenarios.has(id))
      throw new UsageError(`option "${id}" has no --playable`, `add --playable ${id}=<scenario query>`);
  }
  const branch = typeof flags.branch === 'string' ? flags.branch.trim() : undefined;
  const playables = new Map<string, OptionPlayable>();
  for (const [id, scenario] of scenarios) {
    const parsed = OptionPlayable.safeParse({
      scenario,
      ...(seconds.has(id) ? { seconds: Number(seconds.get(id)) } : {}),
      ...(leadIns.has(id) ? { lead_in: leadIns.get(id) } : {}),
      ...(branch ? { branch } : {}),
    });
    if (!parsed.success)
      throw new UsageError(
        `playable "${id}" is invalid: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
        'gm help checkpoint open',
      );
    playables.set(id, parsed.data);
  }
  return playables;
}
