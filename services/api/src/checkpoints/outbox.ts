import { CheckpointOpenPayload, type AgentOutboxLine } from '@ogm/contracts';

import type { OutboxContext } from '../build-chat/outbox-handlers.js';
import { getChatRow, insertChatRow, type StoredCheckpoint } from '../build-chat/store.js';

export const type = 'checkpoint.open';

export async function handle(line: AgentOutboxLine, ctx: OutboxContext): Promise<void> {
  if (getChatRow(ctx.sqlite, line.id) !== null) return;
  const payload = CheckpointOpenPayload.parse(line.payload);
  const options = payload.options.map((option) => {
    if (option.media_id === undefined) return option;
    const media = getChatRow(ctx.sqlite, option.media_id);
    if (media?.jobId === line.job_id) return option;
    ctx.log({
      event: 'checkpoint-media-rejected',
      jobId: line.job_id,
      checkpointId: payload.checkpoint_id,
      mediaId: option.media_id,
      reason: media === null ? 'media_unknown' : 'job_mismatch',
    });
    return {
      id: option.id,
      label: option.label,
      ...(option.playable === undefined ? {} : { playable: option.playable }),
    };
  });
  const checkpoint: StoredCheckpoint = {
    checkpoint_id: payload.checkpoint_id,
    decision_id: '',
    question: payload.question,
    options,
    ...(payload.recommend === undefined ? {} : { recommend: payload.recommend }),
    blocking: payload.blocking,
    ...(payload.pick === undefined ? {} : { pick: payload.pick }),
    ...(payload.topic === undefined ? {} : { topic: payload.topic }),
    status: 'open',
  };
  const { inserted } = insertChatRow(ctx.sqlite, {
    id: line.id,
    jobId: line.job_id,
    at: line.at,
    actor: 'agent',
    kind: 'checkpoint',
    text: payload.question,
    checkpoint,
  });
  if (inserted) ctx.publish(line.job_id);
}
