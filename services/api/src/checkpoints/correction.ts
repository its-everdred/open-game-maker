import type { ChatJob } from '../app/registry.js';
import type { AppDeps } from '../app/types.js';
import { getChatRuntime } from '../build-chat/routes.js';
import { updateCheckpoint, type ChatRow, type StoredCheckpoint } from '../build-chat/store.js';

// A creator who changes a saved answer (#597) on a Command whose job is not a design conversation. aiur keeps the
// answer it was given, because an answered decision cannot be re-answered, so the job's own ticket hears the change in
// one message and the chat row records the answer that now stands. A later change compares against that answer.
export async function correctAnswer(
  deps: AppDeps,
  job: ChatJob & { aiur: NonNullable<ChatJob['aiur']> },
  row: ChatRow,
  checkpoint: StoredCheckpoint,
  optionId: string,
): Promise<boolean> {
  const client = await deps.registry.aiurClientFor?.(job.aiur.daemonSlug);
  if (!client) return false;
  const label = (id: string | undefined) => checkpoint.options.find((option) => option.id === id)?.label ?? id ?? '';
  const checkpointId = checkpoint.checkpoint_id ?? row.id;
  await client.message(
    job.aiur.ticket,
    `The creator changed their answer to "${checkpoint.question}": "${label(optionId)}" now stands instead of "${label(checkpoint.option_id)}". Follow the new answer.`,
    `ogm:correction:${checkpointId}:${checkpoint.version ?? 1}:${checkpoint.option_id ?? ''}:${optionId}`,
  );
  updateCheckpoint(deps.sqlite, row.id, { option_id: optionId });
  getChatRuntime(deps).hub.publish(job.jobId);
  return true;
}
