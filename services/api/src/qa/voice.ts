import type { JobPlan, Reservation } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import { readQaState, updateQaState } from './state.js';
import { gameDrafts } from '../new-game/drafts.js';

// The voice E2E's build (#879): one job on the QA game whose build chat shows the mic and "Start voice conversation", so the
// prod run dictates into its message box and holds a voice session on it. Like an operator publish it is `filed` with
// `releasedAt` set, so it takes no job slot and no daemon runs it; its aiur ticket lives in the `qa` repository, which no
// real game uses.
export const QA_VOICE_REPO = 'qa';
export const QA_VOICE_ISSUE = 879;
export const QA_VOICE_TITLE = 'QA voice';

const jobId = (run: string) => `j_qa-voice-${run}`;

function requireQa(deps: AppDeps) {
  const state = readQaState(deps.db);
  if (!state) throw new HttpError(409, 'qa_account_missing');
  return state;
}

export function seedVoiceFixture(deps: AppDeps, run: string) {
  const state = requireQa(deps);
  deleteVoiceFixtures(deps);
  const at = new Date().toISOString();
  const plan: JobPlan = {
    title: QA_VOICE_TITLE,
    summary: 'The prod voice check: dictation into this chat and one short voice session.',
    scope: { included: ['voice'], excluded: [] },
    tickets: [{ key: 'V1', skills: [], dependsOn: [], acceptanceCriteria: ['voice reaches this chat'] }],
  };
  const reservation: Reservation = { amountMicroUsd: 0, sizeClass: 'small', confidence: 'low' };
  const draft = deps.sqlite
    .transaction(() => {
      deps.db
        .insert(schema.jobs)
        .values({
          id: jobId(run),
          gameId: state.gameId,
          branchId: 'main',
          familyId: state.familyId,
          creatorId: state.userId,
          kind: 'feature',
          complexity: 1,
          state: 'filed',
          start: 'now',
          startAt: null,
          slot: 'edit',
          plan: JSON.stringify(plan),
          reservation: JSON.stringify(reservation),
          hardCapMicroUsd: 0,
          usageMicroUsd: 0,
          aiurRepo: QA_VOICE_REPO,
          aiurIssueNumber: QA_VOICE_ISSUE,
          releasedAt: at,
          createdAt: at,
          updatedAt: at,
        })
        .run();
      const seededDraft = gameDrafts.create(deps.db, {
        familyId: state.familyId,
        creatorId: state.userId,
        choices: {
          genre: 'Open-ended',
          vibe: 'Open-ended',
          family: 'any',
          world: 'Open-ended',
          players: 'single',
          pov: 'fixed',
        },
        allowAiGeneratedAssets: true,
      });
      gameDrafts.attachTicket(deps.db, seededDraft.id, QA_VOICE_REPO, QA_VOICE_ISSUE);
      updateQaState(deps.db, (qa) => {
        qa.voiceDraftId = seededDraft.id;
        qa.voiceDraftRun = run;
        qa.tickets = [
          ...(qa.tickets ?? []).filter((ticket) => ticket.identifier !== String(QA_VOICE_ISSUE)),
          {
            identifier: String(QA_VOICE_ISSUE),
            title: QA_VOICE_TITLE,
            url: null,
            state: 'open',
            status: 'working',
            phase: 'work',
            summary: { text: 'QA voice check' },
            pr: null,
            live: { running: true, activity: null },
            media: [],
            timeline: [],
          },
        ];
      });
      return seededDraft;
    })
    .immediate();
  return { gameId: state.gameId, jobId: jobId(run), title: QA_VOICE_TITLE, draftId: draft.id };
}

// What reached the run's build chat: the voice host stores each final turn there, the creator's and the agent's.
export function voiceFixtureReport(deps: AppDeps, run: string) {
  requireQa(deps);
  const job = deps.db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId(run)))
    .get();
  if (!job) throw new HttpError(404, 'qa_run_not_found');
  const messages = deps.db
    .select({
      actor: schema.buildChatMessages.actor,
      kind: schema.buildChatMessages.kind,
      text: schema.buildChatMessages.text,
    })
    .from(schema.buildChatMessages)
    .where(eq(schema.buildChatMessages.jobId, job.id))
    .orderBy(asc(schema.buildChatMessages.seq))
    .all();
  const draftId = readQaState(deps.db)?.voiceDraftId;
  const draftMessages = draftId
    ? deps.db
        .select({
          actor: schema.buildChatMessages.actor,
          kind: schema.buildChatMessages.kind,
          text: schema.buildChatMessages.text,
        })
        .from(schema.buildChatMessages)
        .where(eq(schema.buildChatMessages.jobId, `draft:${draftId}`))
        .orderBy(asc(schema.buildChatMessages.seq))
        .all()
    : [];
  return { jobId: job.id, messages, draftId, draftMessages };
}

// Removes the voice builds a run left (every run's when none is named) and their chat rows.
export function deleteVoiceFixtures(deps: AppDeps, run?: string) {
  const state = requireQa(deps);
  const draftId = run === undefined || state.voiceDraftRun === run ? state.voiceDraftId : undefined;
  if (run === undefined || state.tickets?.some((ticket) => ticket.identifier === String(QA_VOICE_ISSUE))) {
    const active = deps.db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId(run ?? '')))
      .get();
    if (run === undefined || active)
      updateQaState(deps.db, (qa) => {
        qa.tickets = (qa.tickets ?? []).filter((ticket) => ticket.identifier !== String(QA_VOICE_ISSUE));
      });
  }
  deps.db.transaction((tx) => {
    const ids = tx
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.gameId, state.gameId),
          eq(schema.jobs.aiurRepo, QA_VOICE_REPO),
          ...(run === undefined ? [] : [eq(schema.jobs.id, jobId(run))]),
        ),
      )
      .all()
      .map(({ id }) => id);
    if (ids.length === 0) return;
    tx.delete(schema.buildChatMessages).where(inArray(schema.buildChatMessages.jobId, ids)).run();
    tx.delete(schema.jobs).where(inArray(schema.jobs.id, ids)).run();
  });
  if (draftId) {
    const draftJobId = `draft:${draftId}`;
    deps.db.transaction((tx) => {
      tx.delete(schema.buildChatAttachments).where(eq(schema.buildChatAttachments.jobId, draftJobId)).run();
      tx.delete(schema.buildChatMessages).where(eq(schema.buildChatMessages.jobId, draftJobId)).run();
      tx.delete(schema.gameDrafts).where(eq(schema.gameDrafts.id, draftId)).run();
    });
    updateQaState(deps.db, (qa) => {
      if (qa.voiceDraftId === draftId && (run === undefined || qa.voiceDraftRun === run)) {
        delete qa.voiceDraftId;
        delete qa.voiceDraftRun;
      }
    });
  }
}
