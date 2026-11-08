import type { ChatJob } from '../app/registry.js';
import type { AppDeps } from '../app/types.js';
import { getChatRuntime } from '../build-chat/routes.js';
import { updateCheckpoint, type ChatRow, type StoredCheckpoint } from '../build-chat/store.js';

// A creator who changes a saved answer (#597) on a Command whose job is not a design conversation. aiur keeps the
// answer it was given, because an answered decision cannot be re-answered, so the job's own ticket hears the change in
// one message and the chat row records the answer that now stands beside aiur's. A later change compares against it.
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
  const standing = checkpoint.corrected_option_id ?? checkpoint.option_id;
  // Numbered, so changing back and forth sends each change once and a retry of the same change sends nothing new.
  const corrections = (checkpoint.corrections ?? 0) + 1;
  await client.message(
    job.aiur.ticket,
    `The creator changed their answer to "${checkpoint.question}": "${label(optionId)}" now stands instead of "${label(standing)}". Follow the new answer.`,
    `ogm:correction:${checkpointId}:${checkpoint.version ?? 1}:${corrections}`,
  );
  updateCheckpoint(deps.sqlite, row.id, { corrected_option_id: optionId, corrections });
  getChatRuntime(deps).hub.publish(job.jobId);
  return true;
}
