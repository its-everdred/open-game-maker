import { CommandRequestPayload, type AgentOutboxLine } from '@ogm/contracts';

import type { OutboxContext } from '../build-chat/outbox-handlers.js';
import { getChatRow, insertChatRow, type StoredCommand } from '../build-chat/store.js';

export const type = 'command.request';
// `gm checkpoint open` before #571 wrote `checkpoint.open` lines keyed `checkpoint_id`; a job running across the upgrade
// still has them. Read them for one release, with the CLI alias; delete with it.
export const aliasTypes = ['checkpoint.open'];

function upgraded(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || !('checkpoint_id' in payload)) return payload;
  const { checkpoint_id, ...rest } = payload as Record<string, unknown>;
  return { ...rest, command_id: checkpoint_id };
}

export async function handle(line: AgentOutboxLine, ctx: OutboxContext): Promise<void> {
  if (getChatRow(ctx.sqlite, line.id) !== null) return;
  const payload = CommandRequestPayload.parse(line.type === type ? line.payload : upgraded(line.payload));
  const options = payload.options.map((option) => {
    if (option.media_id === undefined) return option;
    const media = getChatRow(ctx.sqlite, option.media_id);
    if (media?.jobId === line.job_id) return option;
    ctx.log({
      event: 'command-media-rejected',
      jobId: line.job_id,
      commandId: payload.command_id,
      mediaId: option.media_id,
      reason: media === null ? 'media_unknown' : 'job_mismatch',
    });
    const withoutMedia = { ...option };
    delete withoutMedia.media_id;
    return withoutMedia;
  });
  const command: StoredCommand = {
    command_id: payload.command_id,
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
    kind: 'command',
    text: payload.question,
    command,
  });
  if (inserted) ctx.publish(line.job_id);
}
