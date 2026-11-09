import { useCallback, useEffect } from 'react';

import type { Job } from '@ogm/contracts';

import { registerTestApi } from '../../app/testHook';
import { AiurConversation, jobScope } from '../aiur/embed';
import { Bar } from './Bar';
import { Chat } from './Chat';
import { answerJobCommand } from './commands';
import { useDock } from './dock';
import { JobList } from './JobList';
import { isTerminal, useBudgetUnitLabel, useMyJobs } from './jobs';
import type { StreamedChatMessage } from './stream';
import './dock.css';
import './chat.css';

const testState: {
  dockState: string;
  jobs: Job[];
  messagesByJob: Record<string, StreamedChatMessage[]>;
} = { dockState: 'collapsed', jobs: [], messagesByJob: {} };
let testApiRegistered = false;

export function BuildChatDock() {
  const { jobs } = useMyJobs();
  const unitLabel = useBudgetUnitLabel();
  const dock = useDock();
  const { draft } = dock;
  const selected =
    dock.openJobId !== undefined
      ? jobs.find(({ id }) => id === dock.openJobId)
      : draft &&
        jobs.find((job) => job.gameId === draft.gameId && job.branchId === draft.branchId && !isTerminal(job.state));

  testState.dockState = dock.view;
  testState.jobs = jobs;
  useEffect(() => {
    if (testApiRegistered || !window.__ogmHost) return;
    registerTestApi('jobs', {
      get dockState() {
        return testState.dockState;
      },
      get jobs() {
        return testState.jobs;
      },
      get messagesByJob() {
        return testState.messagesByJob;
      },
      open(jobId: string) {
        useDock.getState().openChat(jobId, testState.jobs);
      },
    });
    testApiRegistered = true;
  }, []);

  const recordMessages = useCallback((jobId: string, messages: StreamedChatMessage[]) => {
    testState.messagesByJob[jobId] = messages;
  }, []);

  if (dock.view === 'collapsed') return null;

  const openJob = (job: Job) => dock.openChat(job.id, jobs);
  const chatJobId = dock.openJobId ?? selected?.id;
  const chat = (
    <Chat
      key={dock.chatKey}
      jobId={chatJobId}
      job={selected}
      draft={draft}
      onBack={() => dock.back(jobs)}
      onAdmitted={dock.admitted}
      onMessages={recordMessages}
    />
  );
  return (
    <aside className="build-chat-dock" data-state={dock.view}>
      <div className="build-chat-panel">
        {dock.view === 'chat' && (selected || draft) ? (
          <div className="build-chat-chat-layout">
            <div className="build-chat-landscape-list">
              <JobList jobs={jobs} unitLabel={unitLabel} onOpen={openJob} />
            </div>
            {selected && chatJobId ? (
              // Editor feature scoping shares the job conversation component; aiur replaces the build chat once its
              // element is installed, while the job list beside it stays Open Game Maker's.
              <AiurConversation
                scope={jobScope(
                  selected.gameId,
                  chatJobId,
                  selected.aiurIssueNumber === null ? null : String(selected.aiurIssueNumber),
                )}
                title={selected.plan.title}
                onAnswer={(detail) => void answerJobCommand(detail.job_id, detail.command_id, detail.option_id)}
              >
                {chat}
              </AiurConversation>
            ) : (
              chat
            )}
          </div>
        ) : (
          <>
            <header className="build-chat-panel-head">
              <h3>Builds</h3>
              <button className="build-chat-close tap-secondary" type="button" onClick={() => dock.close(jobs)}>
                Close
              </button>
            </header>
            <Bar jobs={jobs} expanded={dock.view === 'expanded'} onToggle={() => dock.toggleList(jobs)} />
            {dock.view === 'expanded' ? <JobList jobs={jobs} unitLabel={unitLabel} onOpen={openJob} /> : null}
          </>
        )}
      </div>
    </aside>
  );
}
