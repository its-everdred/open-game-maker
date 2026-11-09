import type { Decision } from '@ogm/aiur-client';
import { CREATOR_AUDIENCE_MARKER, CREATOR_TEXT_ONLY_MARKER } from '@ogm/contracts';

import { parseCommand, type ChatRow, type StoredCommand } from '../build-chat/store.js';
import { summaryOf } from '../commands/aiur.js';
import { creatorAudience } from '../commands/audience.js';

// `gm-checkpoint:` is the marker before #571 renamed it; Commands raised then are still open in aiur.
const marker = /gm-(?:command|checkpoint):(cp_[0-7][0-9A-HJKMNP-TV-Z]{25})/;
const openStatuses = new Set(['open', 'pending', 'deferred']);
const answeredStatuses = new Set(['answered', 'decided', 'acknowledged', 'resolved']);
const mootStatuses = new Set(['expired', 'dismissed', 'moot']);

export function commandMarker(decision: Decision): string | null {
  for (const source of [decision.context?.long_context_markdown, decision.context?.short_summary, decision.question]) {
    if (typeof source !== 'string') continue;
    const match = marker.exec(source);
    if (match) return match[1] as string;
  }
  return null;
}

// Whether the creator sees this Command (#595). Only player-facing questions reach the creator's inbox, menu count and
// review deck: a decision Game Maker marked for the creator, or one opened through `gm command request`. Any other decision
// (an engineering or operations question an agent raised with plain `aiur command request`) stays with the Executor.
// Aiur has no audience field yet, so a decision without the marker is treated as the Executor's.
export function isForCreator(decision: Decision): boolean {
  if (commandMarker(decision) !== null) return true;
  return [decision.context?.long_context_markdown, decision.context?.short_summary, decision.question].some(
    (source) => typeof source === 'string' && source.includes(CREATOR_AUDIENCE_MARKER),
  );
}

// A product question (#612): a creator Command `gm ask` marked text-only. It queues for a voice session instead of
// showing in the deck. The marker only counts on a decision that is the creator's.
export function isTextOnly(decision: Decision): boolean {
  return (
    isForCreator(decision) &&
    [decision.context?.long_context_markdown, decision.context?.short_summary, decision.question].some(
      (source) => typeof source === 'string' && source.includes(CREATOR_TEXT_ONLY_MARKER),
    )
  );
}

// aiur marks a decision that takes several answers with `multi_select`; a review deck's answer is the likes and
// dislikes rather than one card. Everything else asks for one pick.
export function pickOf(decision: Decision): 'one' | 'many' {
  return decision.questions?.[0]?.multi_select === true ? 'many' : 'one';
}

export function answeredOption(decision: Decision): string | undefined {
  const answer = decision.active_answer ?? decision.answer;
  if (answer === null || answer === undefined) return undefined;
  return answer.selected_option_id ?? answer.option_id ?? answer.option ?? undefined;
}

export function statusOf(decision: Decision): 'open' | 'answered' | 'moot' {
  if (decision.active_answer != null || decision.answer != null) return 'answered';
  if (mootStatuses.has(decision.decision_status)) return 'moot';
  if (openStatuses.has(decision.decision_status)) return 'open';
  if (answeredStatuses.has(decision.decision_status)) return 'answered';
  return 'open';
}

export function recommendationOf(decision: Decision): string | undefined {
  return decision.recommendation?.option_id ?? undefined;
}

function isNativeChoice(decision: Decision): boolean {
  const questionCount = decision.questions?.length;
  const multiSelect = decision.questions?.[0]?.multi_select === true;
  return (
    // `gm ask` raises a product question as a plain decision, with no checkpoint, so it is mirrored like a native one.
    (decision.kind === 'native_question' || isTextOnly(decision)) &&
    decision.options.length >= 2 &&
    decision.options.length <= 5 &&
    (questionCount === undefined || questionCount === 1) &&
    !multiSelect
  );
}

export type CorrelationUpdate = {
  row: ChatRow;
  decision?: Decision;
  patch: Partial<StoredCommand>;
};

export type CorrelationPlan = {
  create: Decision[];
  update: CorrelationUpdate[];
};

export function correlate(decisions: Decision[], rows: ChatRow[]): CorrelationPlan {
  const commands = rows.flatMap((row) => {
    const command = parseCommand(row);
    return command === null ? [] : [{ row, command }];
  });
  const seen = new Set<string>();
  const create: Decision[] = [];
  const update: CorrelationUpdate[] = [];

  for (const decision of decisions) {
    const linked = commands.find(({ command }) => command.decision_id === decision.decision_id);
    const commandId = commandMarker(decision);
    const marked = commandId ? commands.find(({ command }) => command.command_id === commandId) : undefined;
    const found = linked ?? marked;
    if (!found) {
      if (commandId === null && statusOf(decision) === 'open' && isNativeChoice(decision) && isForCreator(decision))
        create.push(decision);
      continue;
    }
    seen.add(found.row.id);
    const status = statusOf(decision);
    const optionId = answeredOption(decision);
    update.push({
      row: found.row,
      decision,
      patch: {
        decision_id: decision.decision_id,
        version: decision.version,
        blocking: decision.blocking,
        pick: pickOf(decision),
        status,
        ...(optionId === undefined ? {} : { option_id: optionId }),
        // Who the decision is for and its topic follow aiur on every poll, so a row stored before aiur set them (or
        // before this app read them) catches up instead of staying hidden from the creator or topic-less. A builder's
        // Command keeps its job's title: `gm command request` sends the same placeholder topic for every question.
        audience: creatorAudience(decision),
        text_only: isTextOnly(decision) ? true : undefined,
        summary: found.command.command_id === decision.decision_id ? summaryOf(decision) : undefined,
      },
    });
  }

  for (const { row, command } of commands) {
    if (command.status === 'open' && command.decision_id !== '' && !seen.has(row.id)) {
      update.push({ row, patch: { status: 'moot' } });
    }
  }
  return { create, update };
}
