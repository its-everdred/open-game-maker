import { Dialog } from '../../components/Dialog';
import { AiurConversation, jobScope, type AiurCommandAnswer } from '../aiur/embed';
import { Chat } from './Chat';
import { answerJobCommand } from './commands';
import { useConversation } from './conversation';
import { useMyJobs } from './jobs';
import './conversation-modal.css';

// A job's conversation over the current screen (M2, A2b). When aiur ships the embeddable conversation the element
// replaces the markup below it; until then the build chat's own stream and composer render inside the same dialog.
export function JobConversationModal() {
  const jobId = useConversation((state) => state.jobId);
  const close = useConversation((state) => state.close);
  const { jobs } = useMyJobs();
  const job = jobId === undefined ? undefined : jobs.find(({ id }) => id === jobId);
  if (!job) return null;

  const answer = (detail: AiurCommandAnswer) => {
    if (detail.job_id !== job.id) return;
    void answerJobCommand(detail.job_id, detail.command_id, detail.option_id);
  };

  return (
    <Dialog
      title={job.plan.title}
      className="job-conversation-dialog"
      backdropClassName="job-conversation-backdrop"
      onClose={close}
    >
      <button type="button" className="job-conversation-close" aria-label="Close" onClick={close}>
        <span aria-hidden="true">×</span>
      </button>
      <AiurConversation
        scope={jobScope(job.gameId, job.id, job.aiurIssueNumber === null ? null : String(job.aiurIssueNumber))}
        title={job.plan.title}
        onAnswer={answer}
      >
        <Chat key={job.id} jobId={job.id} job={job} onBack={close} heading={false} />
      </AiurConversation>
    </Dialog>
  );
}
