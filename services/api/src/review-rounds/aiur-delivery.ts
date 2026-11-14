import type { AiurClient } from '@ogm/aiur-client';
import type { ReworkDelivery } from './rework.js';

// The transcript includes queued operator input as well as delivered turns. A queued marker proves that a second
// rework should not be sent, but does not by itself prove that a worker consumed it.
export function aiurReworkDelivery(
  client: Pick<AiurClient, 'ticketTranscript' | 'rework' | 'issue'>,
  roundId: string,
  verdictAt: string,
): ReworkDelivery {
  return {
    async findMarker(ticket, marker) {
      let cursor: string | undefined;
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const page = await client.ticketTranscript(ticket, cursor);
        const marked = page.events.find((event) => event.body.includes(marker));
        if (marked) {
          if (marked.turn_id) return { runId: marked.turn_id };
          const issue = await client.issue(ticket);
          const run = issue.running;
          const started = run?.started_at;
          const session = run?.session_id;
          const runId =
            issue.status === 'running' &&
            issue.queue.depth === 0 &&
            typeof session === 'string' &&
            typeof started === 'string' &&
            Date.parse(started) >= Date.parse(verdictAt)
              ? session
              : null;
          return { runId };
        }
        if (page.nextCursor === null) return null;
        if (page.nextCursor === cursor) throw new Error('aiur_transcript_cursor_repeated');
        cursor = page.nextCursor;
      }
      // An incomplete search cannot prove that a previous dispatch did not happen.
      throw new Error('aiur_transcript_search_incomplete');
    },
    async rework(ticket, reason) {
      const issue = await client.issue(ticket);
      if (issue.status === 'running') throw new Error('review_worker_running');
      await client.rework(ticket, reason, `review-round:${roundId}`);
    },
  };
}
