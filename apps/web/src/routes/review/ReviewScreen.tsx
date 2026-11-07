import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import type { VoiceTarget } from '@ogm/contracts';

import { findCommand } from '../../features/commands-inbox/review-route';
import { useGameCommands } from '../../features/commands-inbox/commands';
import { ReviewDeck } from '../../features/commands-inbox/ReviewDeck';
import { useMyJobs } from '../../features/build-chat/jobs';
import './review-screen.css';

// The review deck on its own screen (A3): the deep link `/game/:gameId/review/:commandId` the Executor pushes to the
// creator. It renders the same deck the game's inbox renders, in the studio's own look and chrome, and goes back to
// the game's inbox once the answer lands. The Command stays in the game's inbox after an answer until aiur marks it
// answered, so a reload of this link shows the deck's ending grid, not a second answer.
export function ReviewScreen() {
  const { gameId = '', commandId = '' } = useParams();
  const navigate = useNavigate();
  const { commands, isPending } = useGameCommands(gameId);
  const command = findCommand(commands, commandId);
  const [sent, setSent] = useState(false);
  const back = () => navigate(`/all?spotlight=${encodeURIComponent(gameId)}`);

  // The Command's job is what gives the deck the app's voice support for its whole-set notes: the same build-chat
  // voice target the composer uses. A Command without a job in hand keeps the typed field.
  const { jobs } = useMyJobs();
  const voiceTarget = useMemo<VoiceTarget | undefined>(() => {
    const job = command === undefined ? undefined : jobs.find((candidate) => candidate.id === command.job_id);
    if (job === undefined) return undefined;
    return {
      kind: 'build',
      game_id: job.gameId,
      job_id: job.id,
      ticket: job.aiurIssueNumber === null ? '' : String(job.aiurIssueNumber),
      creator_id: job.creatorId,
    };
  }, [command, jobs]);

  if (sent) {
    return (
      <div className="review-screen">
        <header className="review-screen-head">
          <button className="review-screen-back tap-primary" onClick={back} type="button">
            Back to the game
          </button>
          <h1>Review sent</h1>
        </header>
      </div>
    );
  }

  if (command === undefined) {
    return (
      <div className="review-screen">
        <header className="review-screen-head">
          <button className="review-screen-back tap-primary" onClick={back} type="button">
            Back to the game
          </button>
          <h1>Review</h1>
        </header>
        <p className="review-screen-state" role="status">
          {isPending ? 'Loading the review…' : 'That review is not open. It may already be answered.'}
        </p>
      </div>
    );
  }

  return (
    <div className="review-screen">
      <header className="review-screen-head">
        <button className="review-screen-back tap-primary" onClick={back} type="button">
          Back to the game
        </button>
        <h1>{command.title}</h1>
      </header>
      <div className="review-screen-body">
        <p className="review-screen-question">{command.question}</p>
        <ReviewDeck gameId={gameId} command={command} voiceTarget={voiceTarget} onAnswered={() => setSent(true)} />
      </div>
    </div>
  );
}
