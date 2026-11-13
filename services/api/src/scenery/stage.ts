import { ChatCommand } from '@ogm/contracts';

import type { ChatRow } from '../build-chat/store.js';

/** Select the current visual, preferring a review's recommendation while its decision is open. */
export function selectStageMedia(
  commands: readonly ChatRow[],
  findMedia: (id: string) => ChatRow | null,
  allowAi: boolean,
  reviewTimes: ReadonlyMap<string, string> = new Map(),
): ChatRow | undefined {
  const time = (row: ChatRow) => {
    try {
      const value: unknown = JSON.parse(row.commandJson ?? 'null');
      if (
        typeof value === 'object' &&
        value !== null &&
        'command_id' in value &&
        typeof value.command_id === 'string'
      ) {
        return Date.parse(reviewTimes.get(`${row.jobId}\0${value.command_id}`) ?? row.at);
      }
    } catch {
      /* Ignore malformed commands; the selection pass skips them. */
    }
    return Date.parse(row.at);
  };
  for (const row of [...commands].sort((a, b) => time(b) - time(a) || b.seq - a.seq)) {
    let value: unknown;
    try {
      value = JSON.parse(row.commandJson ?? 'null');
    } catch {
      continue;
    }
    const parsed = ChatCommand.safeParse(value);
    if (!parsed.success || parsed.data.status === 'moot') continue;
    const correction =
      typeof value === 'object' &&
      value !== null &&
      'corrected_option_id' in value &&
      typeof value.corrected_option_id === 'string'
        ? value.corrected_option_id
        : undefined;
    const chosen = correction ?? parsed.data.option_id;
    if (
      parsed.data.status === 'answered' &&
      (!chosen || (!correction && parsed.data.review && !parsed.data.review.likes.includes(chosen)))
    )
      continue;
    const options =
      parsed.data.status === 'answered'
        ? parsed.data.options.filter((item) => item.id === chosen)
        : [...parsed.data.options].sort(
            (a, b) => Number(b.id === parsed.data.recommend) - Number(a.id === parsed.data.recommend),
          );
    for (const option of options) {
      if (!option.media_id || (!allowAi && option.aiGenerated)) continue;
      if (option.provenance?.aspect && !['scene', 'look'].includes(option.provenance.aspect)) continue;
      if (option.provenance?.view && option.provenance.view !== 'player') continue;
      const media = findMedia(option.media_id);
      if (
        media?.jobId === row.jobId &&
        (media.kind === 'image' || media.kind === 'clip') &&
        media.mediaHash &&
        media.width &&
        media.height
      )
        return media;
    }
  }
  return undefined;
}
