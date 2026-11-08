import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';

import type { VoiceTarget } from '@ogm/contracts';
import { reviewPath, type GameCommand } from '@ogm/contracts/browser';

import { findCommand, findCommandByNumber } from '../../features/commands-inbox/review-route';
import { PlayLinkMessage } from '../play/PlayScreen';
import { playLinkDenial, usePlayLink } from '../play/api';
import { useGameCommands } from '../../features/commands-inbox/commands';
import { ReviewDeck } from '../../features/commands-inbox/ReviewDeck';
import { useMyJobs } from '../../features/build-chat/jobs';
import './review-screen.css';

// The short link the Executor pushes to the creator (#591): `/<slug>/review/<n>`, the game's slug and the Command's
// number inside the game. A slug the game has outgrown is rewritten to the current one so the address heals.
export function ShortReviewScreen() {
  const { slug = '', number = '' } = useParams();
  const link = usePlayLink(slug);

  if (link.isError) return <PlayLinkMessage denial={playLinkDenial(link.error)} />;
  if (!link.data) return null;
  const current = link.data.slug;
  if (current && current !== slug && /^[1-9]\d*$/.test(number)) {
    return <Navigate replace to={reviewPath(current, Number(number))} />;
  }
  // Keyed by the review, so moving between two reviews never carries one deck's votes into the other.
  return (
    <ReviewScreen
      key={`${link.data.id}:${number}`}
      gameId={link.data.id}
      find={(commands) => findCommandByNumber(commands, number)}
    />
  );
}

// The link before short links: `/game/<id>/review/<checkpoint or decision id>`. It moves to the short form once the
// game's slug and the Command's number are known; a Command that is no longer open shows the deck's closed state here.
export function LegacyReviewScreen() {
  const { gameId = '', commandId = '' } = useParams();
  const game = usePlayLink(gameId);
  const { commands, isPending } = useGameCommands(gameId);
  const command = findCommand(commands, commandId);

  if (game.isPending || isPending) return null;
  const slug = game.data?.slug;
  if (slug && command?.review_number !== undefined) {
    return <Navigate replace to={reviewPath(slug, command.review_number)} />;
  }
  return <ReviewScreen key={`${gameId}:${commandId}`} gameId={gameId} find={(open) => findCommand(open, commandId)} />;
}

// The review deck on its own screen (A3). It renders the same deck the game's inbox renders, in the studio's own look
// and chrome, and goes back to the game's inbox once the answer lands. The Command stays in the game's inbox after an
// answer until aiur marks it answered, so a reload of this link shows the deck's ending grid, not a second answer.
function ReviewScreen({
  gameId,
  find,
}: {
  gameId: string;
  find(commands: readonly GameCommand[]): GameCommand | undefined;
}) {
  const navigate = useNavigate();
  const { commands, isPending } = useGameCommands(gameId);
  const command = find(commands);
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
