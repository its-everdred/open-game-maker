import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';

import { reviewPath, type GameCommand } from '@ogm/contracts/browser';

import { findCommand, findCommandByNumber } from '../../features/commands-inbox/review-route';
import { PlayLinkMessage } from '../play/PlayScreen';
import { playLinkDenial, usePlayLink } from '../play/api';
import { queryClient } from '../../app/query';
import { gameCommandsQueryKey, useGameCommands } from '../../features/commands-inbox/commands';
import { DecisionVoice, useDucking, type DecisionVoiceTarget } from '../../features/commands-inbox/decision-voice';
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
  const { commands, isPending, isFetching } = useGameCommands(gameId);
  const command = find(commands);
  const back = () => navigate(`/all?spotlight=${encodeURIComponent(gameId)}`);

  // The decision as last read while open. A saved answer drops it from the open list, and changing that answer
  // reopens the same deck from here.
  const [seen, setSeen] = useState<GameCommand>();
  useEffect(() => {
    if (command !== undefined) setSeen(command);
  }, [command]);
  const [saved, setSaved] = useState(false);
  const [correcting, setCorrecting] = useState(0);
  const [voiceUsed, setVoiceUsed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useDucking(speaking);
  const shown = command ?? (correcting > 0 ? seen : undefined);

  // A spoken choice is saved by the voice agent, not by this screen: once a call has run and the decision is no longer
  // open on a fresh read, the answer landed. Worked out during render, so the screen goes straight to Saved and the
  // voice button stays mounted (an effect would render the "not open" state first and hang up the call).
  const spokenSave = voiceUsed && seen !== undefined && command === undefined && !isFetching && correcting === 0;

  // The Command's job is what gives the screen the app's voice support: the same build-chat voice target the composer
  // uses, naming this decision so the agent is briefed on it first. A Command without a job in hand keeps typing only.
  const { jobs } = useMyJobs();
  const voiceTarget = useMemo<DecisionVoiceTarget | undefined>(() => {
    const decision = shown ?? seen;
    const job = decision === undefined ? undefined : jobs.find((candidate) => candidate.id === decision.job_id);
    if (decision === undefined || job === undefined) return undefined;
    return {
      kind: 'build',
      game_id: job.gameId,
      job_id: job.id,
      ticket: job.aiurIssueNumber === null ? '' : String(job.aiurIssueNumber),
      creator_id: job.creatorId,
      command_id: decision.decision_id,
    };
  }, [jobs, seen, shown]);

  const voice =
    voiceTarget === undefined || voiceTarget.ticket === '' ? null : (
      <DecisionVoice
        target={voiceTarget}
        onLive={(live) => {
          if (live) setVoiceUsed(true);
        }}
        onSpeaking={setSpeaking}
        onHeard={() => void queryClient.invalidateQueries({ queryKey: gameCommandsQueryKey(gameId) })}
      />
    );

  if ((saved || spokenSave) && seen !== undefined) {
    return (
      <div className="review-screen">
        <header className="review-screen-head">
          <button className="review-screen-back tap-primary" onClick={back} type="button">
            Back to the game
          </button>
          <h1>Saved</h1>
          {voice}
        </header>
        <div className="review-screen-body">
          <p className="review-screen-question">{seen.question}</p>
          <button
            className="review-screen-change tap-secondary"
            onClick={() => {
              setSaved(false);
              setCorrecting((count) => count + 1);
            }}
            type="button"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  if (shown === undefined) {
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
        <h1>{shown.title}</h1>
        {voice}
      </header>
      <div className="review-screen-body">
        <p className="review-screen-question">{shown.question}</p>
        {/* Keyed by each change, so a correction starts from a fresh deck rather than the votes already sent. */}
        <ReviewDeck
          key={correcting}
          gameId={gameId}
          command={shown}
          voiceTarget={voiceTarget}
          onAnswered={() => {
            setSaved(true);
            setCorrecting(0);
          }}
        />
      </div>
    </div>
  );
}
