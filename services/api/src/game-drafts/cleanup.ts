import type { AppDeps } from '../app/types.js';
import { gameDrafts, type GameDraft } from '../new-game/drafts.js';
import { readQaState, updateQaState } from '../qa/state.js';

export async function discardGameDraft(deps: AppDeps, draft: GameDraft): Promise<void> {
  const qaVoiceFixture = readQaState(deps.db)?.voiceDraftId === draft.id;
  await closeDraftAssistant(deps, draft);
  const jobId = `draft:${draft.id}`;
  let discarded = false;
  deps.sqlite
    .transaction(() => {
      if (!gameDrafts.deleteUnfinished(deps.db, draft.id)) {
        const latest = gameDrafts.get(deps.db, draft.id);
        if (latest && latest.gameId !== null) gameDrafts.clearTicket(deps.db, draft.id);
        return;
      }
      deps.sqlite.prepare('DELETE FROM build_chat_attachments WHERE job_id = ?').run(jobId);
      deps.sqlite.prepare('DELETE FROM build_chat_messages WHERE job_id = ?').run(jobId);
      deps.sqlite.prepare('DELETE FROM build_chat_workspaces WHERE job_id = ?').run(jobId);
      discarded = true;
    })
    .immediate();
  if (qaVoiceFixture && discarded) {
    updateQaState(deps.db, (qa) => {
      if (qa.voiceDraftId === draft.id) {
        delete qa.voiceDraftId;
        delete qa.voiceDraftRun;
      }
    });
  }
}

async function closeDraftAssistant(deps: AppDeps, draft: GameDraft): Promise<void> {
  if (readQaState(deps.db)?.voiceDraftId === draft.id) return;
  if (!draft.ticketRepo) return;
  const assistant = deps.registry.draftScopeAssistant;
  if (!assistant) throw new Error('draft_scope_close_unavailable');
  await assistant.close({
    repo: draft.ticketRepo,
    draftId: draft.id,
    ...(draft.ticketNumber === null ? {} : { ticket: String(draft.ticketNumber) }),
  });
}

export async function sweepExpiredDrafts(deps: AppDeps, now = new Date()): Promise<void> {
  for (const draft of gameDrafts.expired(deps.db, now)) {
    try {
      if (draft.gameId !== null) {
        await closeDraftAssistant(deps, draft);
        gameDrafts.clearTicket(deps.db, draft.id, now.toISOString());
      } else {
        await discardGameDraft(deps, draft);
      }
    } catch (error) {
      deps.log({ event: 'draft-scope-cleanup-failed', draftId: draft.id, error: (error as Error).name });
    }
  }
}

export function startDraftCleanup(deps: AppDeps, intervalMs = 60_000): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      await sweepExpiredDrafts(deps);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void sweep(), intervalMs);
  timer.unref();
  void sweep();
  return () => clearInterval(timer);
}
