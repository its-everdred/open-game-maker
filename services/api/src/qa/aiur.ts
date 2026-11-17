import { Readable } from 'node:stream';

import { AiurHttpError, type AiurClient } from '@ogm/aiur-client';
import type { BlobHash, BlobStore } from '@ogm/blob-store';
import type { Db } from '@ogm/db';

import { isQaGame, readQaState, updateQaState } from './state.js';

const DAEMON = 'qa';

async function unsupported(): Promise<never> {
  throw new AiurHttpError(501, 'qa_unsupported', 'the QA aiur boundary does not serve this call', DAEMON);
}

// The QA game's aiur instance (#859). It serves the Commands a review E2E seeded and records every answer and rework
// that reaches it, so the E2E can assert that a verdict left the app the way a real game's would, with no agent run.
// Everything else a real instance does is refused loudly.
export function createQaAiurClient(db: Db, blobStore: () => BlobStore): AiurClient {
  const decision = (id: string) => {
    const found = readQaState(db)?.decisions.find((item) => item.decision_id === id);
    if (!found) throw new AiurHttpError(404, 'not_found', 'decision not found', DAEMON);
    return found;
  };
  return {
    baseUrl: 'qa://aiur',
    async decisions() {
      return readQaState(db)?.decisions ?? [];
    },
    async decision(id) {
      return decision(id);
    },
    async answerAsCreator(id, answer) {
      const at = new Date().toISOString();
      updateQaState(db, (state) => {
        const found = state.decisions.find((item) => item.decision_id === id);
        if (!found || found.ticket.identifier !== answer.ticket)
          throw new AiurHttpError(404, 'not_found', 'decision not found', DAEMON);
        if (found.version !== answer.expected_version || found.decision_status !== 'open')
          throw new AiurHttpError(409, 'conflict', 'decision already answered', DAEMON);
        found.decision_status = 'answered';
        found.version += 1;
        state.received.push({
          kind: 'answer',
          at,
          ticket: answer.ticket,
          decisionId: id,
          ...(answer.option === undefined ? {} : { option: answer.option }),
          ...(answer.response === undefined ? {} : { response: answer.response }),
        });
      });
    },
    async decisionMedia(id, attachmentId) {
      const known = decision(id).options.some((option) =>
        (option.media ?? []).some((item) => item.locator?.attachment_id === attachmentId),
      );
      const file = known ? await blobStore().open(attachmentId as BlobHash) : null;
      if (!file) throw new AiurHttpError(404, 'not_found', 'attachment not found', DAEMON);
      return {
        mime: file.ref.mime,
        body: Readable.toWeb(Readable.from(file.stream)) as ReadableStream<Uint8Array>,
      };
    },
    async ticketTranscript() {
      return { events: [], nextCursor: null };
    },
    async rework(ticket, reason, key) {
      const at = new Date().toISOString();
      updateQaState(db, (state) => {
        state.received.push({ kind: 'rework', at, ticket, key, reason });
      });
    },
    async message() {
      return { request_id: 'qa' };
    },
    async healthz() {
      return true;
    },
    state: unsupported,
    issue: unsupported,
    usage: unsupported,
    progress: unsupported,
    setSpendCap: unsupported,
    cancel: unsupported,
    pause: unsupported,
    resume: unsupported,
    nudgeTodo: unsupported,
    enqueueTodo: unsupported,
    accounts: unsupported,
    events: unsupported,
    eventsToken: unsupported,
    decide: unsupported,
  };
}

// The game-to-instance lookup with the QA game routed to its QA boundary; every other game is untouched.
export function withQaAiur(
  db: Db,
  qa: AiurClient,
  real: (gameId: string) => Promise<AiurClient>,
): (gameId: string) => Promise<AiurClient> {
  return async (gameId) => (isQaGame(db, gameId) ? qa : real(gameId));
}
