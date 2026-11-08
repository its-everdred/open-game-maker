import type { Decision } from '@ogm/aiur-client';
import { CREATOR_AUDIENCE_MARKER } from '@ogm/contracts';

import { parseCheckpoint, type ChatRow, type StoredCheckpoint } from '../build-chat/store.js';

const marker = /gm-checkpoint:(cp_[0-7][0-9A-HJKMNP-TV-Z]{25})/;
const openStatuses = new Set(['open', 'pending', 'deferred']);
const answeredStatuses = new Set(['answered', 'decided', 'acknowledged', 'resolved']);
const mootStatuses = new Set(['expired', 'dismissed', 'moot']);

export function checkpointMarker(decision: Decision): string | null {
  for (const source of [decision.context?.long_context_markdown, decision.context?.short_summary, decision.question]) {
    if (typeof source !== 'string') continue;
    const match = marker.exec(source);
    if (match) return match[1] as string;
  }
  return null;
}

// Whether the creator sees this Command (#595). Only player-facing questions reach the creator's inbox, menu count and
// review deck: a decision Game Maker marked for the creator, or one opened through a gm checkpoint. Any other decision
// (an engineering or operations question an agent raised with plain `aiur command request`) stays with the Executor.
// Aiur has no audience field yet, so a decision without the marker is treated as the Executor's.
export function isForCreator(decision: Decision): boolean {
  if (checkpointMarker(decision) !== null) return true;
  return [decision.context?.long_context_markdown, decision.context?.short_summary, decision.question].some(
    (source) => typeof source === 'string' && source.includes(CREATOR_AUDIENCE_MARKER),
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
    decision.kind === 'native_question' &&
    decision.options.length >= 2 &&
    decision.options.length <= 5 &&
    (questionCount === undefined || questionCount === 1) &&
    !multiSelect
  );
}

export type CorrelationUpdate = {
  row: ChatRow;
  decision?: Decision;
  patch: Partial<StoredCheckpoint>;
};

export type CorrelationPlan = {
  create: Decision[];
  update: CorrelationUpdate[];
};

export function correlate(decisions: Decision[], rows: ChatRow[]): CorrelationPlan {
  const checkpoints = rows.flatMap((row) => {
    const checkpoint = parseCheckpoint(row);
    return checkpoint === null ? [] : [{ row, checkpoint }];
  });
  const seen = new Set<string>();
  const create: Decision[] = [];
  const update: CorrelationUpdate[] = [];

  for (const decision of decisions) {
    const linked = checkpoints.find(({ checkpoint }) => checkpoint.decision_id === decision.decision_id);
    const checkpointId = checkpointMarker(decision);
    const marked = checkpointId
      ? checkpoints.find(({ checkpoint }) => checkpoint.checkpoint_id === checkpointId)
      : undefined;
    const found = linked ?? marked;
    if (!found) {
      if (checkpointId === null && statusOf(decision) === 'open' && isNativeChoice(decision) && isForCreator(decision))
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
      },
    });
  }

  for (const { row, checkpoint } of checkpoints) {
    if (checkpoint.status === 'open' && checkpoint.decision_id !== '' && !seen.has(row.id)) {
      update.push({ row, patch: { status: 'moot' } });
    }
  }
  return { create, update };
}
