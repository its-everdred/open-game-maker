import type { TicketDetail } from '@ogm/aiur-client';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import type { QaMedia } from './fixtures.js';
import { readQaState, updateQaState } from './state.js';
import { QA_VOICE_ISSUE } from './voice.js';

// Two tickets on the QA game (#873), as aiur's ticket detail (aiur-team/aiur#8043) describes them: one running and one
// closed, each with a picture, a clip and a sound, a summary and a timeline with a creator verdict. The hammer panel
// lists them like a real game's and opens their detail through the real route; only the aiur boundary is the QA one.
export const runningTicket = (run: string) => `${run}-run`;
export const closedTicket = (run: string) => `${run}-done`;

export async function seedTicketFixtures(deps: AppDeps, run: string, media: QaMedia) {
  if (!readQaState(deps.db)) throw new HttpError(409, 'qa_account_missing');
  const [still, clip, audio] = await Promise.all([
    deps.blobStore.put(media.still, 'image/png'),
    deps.blobStore.put(media.clip, 'video/mp4'),
    deps.blobStore.put(media.audio, 'audio/mpeg'),
  ]);
  const at = new Date().toISOString();
  const detail = (identifier: string, open: boolean): TicketDetail => {
    const file = (kind: string, mime: string, hash: string, caption: string) => ({
      id: hash,
      kind,
      mime,
      caption,
      url: `/api/v1/tickets/${identifier}/media/${hash}?exp=0&sig=qa`,
    });
    return {
      identifier,
      title: open ? 'QA running ticket' : 'QA closed ticket',
      url: null,
      state: open ? 'open' : 'closed',
      status: open ? 'working' : 'done',
      phase: open ? 'work' : null,
      summary: { text: open ? 'QA: building the forest backdrop.' : 'QA: the forest backdrop shipped.' },
      pr: null,
      live: { running: open, activity: open ? 'Capturing stills' : null },
      media: [
        file('image', 'image/png', still.hash, 'Forest still'),
        file('video', 'video/mp4', clip.hash, 'Forest clip'),
        file('audio', 'audio/mpeg', audio.hash, 'Forest sound'),
      ],
      timeline: [
        { at, kind: 'round_started', round: 1, label: 'Round 1 started' },
        { at, kind: 'creator_verdict', round: 1, label: 'Needs changes', detail: { quote: 'QA: make it greener' } },
        ...(open ? [] : [{ at, kind: 'closed', label: 'Closed' }]),
      ],
    };
  };
  const tickets = [detail(runningTicket(run), true), detail(closedTicket(run), false)];
  updateQaState(deps.db, (state) => {
    const ids = new Set(tickets.map((ticket) => ticket.identifier));
    state.tickets = [...(state.tickets ?? []).filter((ticket) => !ids.has(ticket.identifier)), ...tickets];
  });
  return { running: runningTicket(run), closed: closedTicket(run) };
}

// Removes a run's tickets, or every run's with no run.
export function deleteTicketFixtures(deps: AppDeps, run?: string) {
  if (!readQaState(deps.db)) throw new HttpError(409, 'qa_account_missing');
  updateQaState(deps.db, (state) => {
    state.tickets = (state.tickets ?? []).filter(
      (ticket) =>
        ticket.identifier === String(QA_VOICE_ISSUE) ||
        (run !== undefined && ticket.identifier !== runningTicket(run) && ticket.identifier !== closedTicket(run)),
    );
  });
}

// The QA game's builds and completed tickets, in the shapes the workers and completed routes answer.
export function qaWorkers(deps: AppDeps) {
  return (readQaState(deps.db)?.tickets ?? [])
    .filter((ticket) => ticket.state === 'open')
    .map((ticket) => ({
      ticket: ticket.identifier,
      title: ticket.title,
      percent: 40,
      etaSeconds: null,
      phase: 'work',
    }));
}

export function qaCompleted(deps: AppDeps) {
  return (readQaState(deps.db)?.tickets ?? [])
    .filter((ticket) => ticket.state === 'closed')
    .map((ticket) => {
      const closedAt = ticket.timeline.at(-1)?.at ?? new Date(0).toISOString();
      return { ticket: ticket.identifier, title: ticket.title, closedAt, outcome: 'Completed', url: '', jobId: null };
    });
}
