import { queryClient } from '../../app/query';
import { api } from '../../lib/api/client';
import { myJobsQueryKey } from './jobs';

import type { CommandReview } from '@ogm/contracts';

// One answer path for every surface: the job's checkpoint route validates the option against the job's checkpoint and
// calls aiur's canonical Decision API, so the inbox, the conversation modal and an inline checkpoint card all agree.
// A review deck's answer also carries the whole like/dislike map, so aiur and the worker see what the creator rejected
// and why.
export async function answerCheckpoint(
  jobId: string,
  checkpointId: string,
  optionId: string,
  review?: CommandReview,
): Promise<void> {
  await api(`/jobs/${encodeURIComponent(jobId)}/checkpoints/${encodeURIComponent(checkpointId)}/answer`, {
    method: 'POST',
    json: { option_id: optionId, ...(review === undefined ? {} : { review }) },
  });
  await queryClient.invalidateQueries({ queryKey: myJobsQueryKey });
}
