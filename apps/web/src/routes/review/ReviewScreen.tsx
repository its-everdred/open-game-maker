import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';

import { gamePath, reviewPath, type GameCommand } from '@ogm/contracts/browser';

import { findCommand, findCommandByNumber } from '../../features/commands-inbox/review-route';
import { withoutLinks } from '../../features/commands-inbox/review';
import { PlayLinkMessage } from '../play/PlayScreen';
import { playLinkDenial, usePlayLink } from '../play/api';
import { queryClient } from '../../app/query';
import { gameCommandsQueryKey, useGameCommands } from '../../features/commands-inbox/commands';
import { DecisionVoice, useDucking, type DecisionVoiceTarget } from '../../features/commands-inbox/decision-voice';
import { reopenDraft, useIsSent, useServerDrafts } from '../../features/commands-inbox/drafts';
import { GlowBackdrop } from '../../features/commands-inbox/GlowBackdrop';
import { ReviewDeck } from '../../features/commands-inbox/ReviewDeck';
import { ReviewRows } from '../../features/commands-inbox/ReviewRows';
import { Icon } from '../../components/Icon';
import { useMyJobs } from '../../features/build-chat/jobs';
import { reviewTitle } from './title';
import { PreviewReviews, usePreviews } from './PreviewReviews';
import { ReviewChoice } from './ReviewChoice';
import './review-screen.css';

// The short link the Executor pushes to the creator (#591): `/<slug>/review/<n>`, the game's slug and the Command's
// number inside the game. A slug the game has outgrown is rewritten to the current one so the address heals.
// `/<slug>/review` with no number is the game's inbox: every open question as a row.
export function ShortReviewScreen() {
  const { slug = '', number } = useParams();
  const link = usePlayLink(slug);

  if (link.isError) return <PlayLinkMessage denial={playLinkDenial(link.error)} />;
  if (!link.data) return null;
  const current = link.data.slug || slug;
  if (current !== slug) {
    if (number === undefined) return <Navigate replace to={reviewsPath(current)} />;
    if (/^[1-9]\d*$/.test(number)) return <Navigate replace to={reviewPath(current, Number(number))} />;
  }
  if (number === undefined) return <ReviewList gameId={link.data.id} slug={current} title={link.data.title} />;
  // Keyed by the review so a deck's local view (its swipe, its open viewer) starts fresh; the votes themselves are
  // drafts kept per question, so moving between reviews never loses them or carries them across.
  return (
    <ReviewScreen
      key={`${link.data.id}:${number}`}
      gameId={link.data.id}
      slug={current}
      number={Number(number)}
      find={(commands) => findCommandByNumber(commands, number)}
    />
  );
}

function reviewsPath(slug: string): string {
  return `${gamePath(slug)}/review`;
}

// The questions the arrows walk: the game's numbered reviews, in number order.
function numbered(commands: readonly GameCommand[]): GameCommand[] {
  return commands
    .filter((command) => command.review_number !== undefined)
    .sort((a, b) => a.review_number! - b.review_number!);
}

// The glossy review surface: the games screen's drifting glows behind glass, with the app's own header for
// getting around.
function ReviewFrame({ head, children }: { head: ReactNode; children?: ReactNode }) {
  return (
    <div className="review-screen">
      <GlowBackdrop />
      <header className="review-screen-head">{head}</header>
      {children}
    </div>
  );
}

function CloseButton({ onClose }: { onClose(): void }) {
  return (
    <button className="review-screen-close tap-secondary" onClick={onClose} type="button" aria-label="Close">
      <Icon name="close" />
    </button>
  );
}

// The game's inbox on its own screen: every open question as a row. The X goes back to the game.
function ReviewList({ gameId, slug, title }: { gameId: string; slug: string; title: string }) {
  const navigate = useNavigate();
  const { commands, isPending } = useGameCommands(gameId);
  useServerDrafts(gameId);
  const rows = numbered(commands);
  const previews = usePreviews(gameId);
  return (
    <ReviewFrame
      head={
        <>
          <h1>{title}</h1>
          <CloseButton onClose={() => navigate(`/all?spotlight=${encodeURIComponent(gameId)}`)} />
        </>
      }
    >
      <div className="review-screen-body">
        <PreviewReviews gameId={gameId} previews={previews.data?.previews ?? []} />
        {previews.isError ? (
          <p className="review-screen-state" role="alert">
            Previews could not be loaded.
          </p>
        ) : null}
        {rows.length > 0 ? (
          <ReviewRows
            commands={rows}
            hrefOf={(command) => reviewPath(slug, command.review_number!)}
            actions={(command) => <ReviewChoice gameId={gameId} command={command} />}
          />
        ) : isPending || previews.isPending || previews.isError ? null : (previews.data?.previews.length ?? 0) === 0 ? (
          <p className="review-screen-state" role="status">
            That review is not open. It may already be answered.
          </p>
        ) : null}
      </div>
    </ReviewFrame>
  );
}

// Previous and next walk the game's questions without closing the deck; each keeps its own draft.
function StepLink({ to, label, icon }: { to: string | undefined; label: string; icon: 'caretLeft' | 'caretRight' }) {
  if (to === undefined) {
    return (
      <span aria-hidden="true" className="review-screen-step review-screen-step-off tap-secondary">
        <Icon name={icon} />
      </span>
    );
  }
  return (
    <Link aria-label={label} className="review-screen-step tap-secondary" replace to={to}>
      <Icon name={icon} />
    </Link>
  );
}

// The link before short links: `/game/<id>/review/<command or decision id>`. It moves to the short form once the
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
  slug,
  number,
  find,
}: {
  gameId: string;
  slug?: string;
  // The review's number from a short link: the arrows walk from it even once an answered review leaves the list.
  number?: number;
  find(commands: readonly GameCommand[]): GameCommand | undefined;
}) {
  const navigate = useNavigate();
  const { commands, isPending, isFetching } = useGameCommands(gameId);
  const command = find(commands);
  // A review sent earlier (moved away from, then back to) stays sent: no second deck to answer it again.
  const sentBefore = useIsSent(command);
  // A short link closes to the game's rows; a legacy link, with no slug to build them from, closes to the game.
  const back = () => navigate(slug === undefined ? `/all?spotlight=${encodeURIComponent(gameId)}` : reviewsPath(slug));
  const here = command?.review_number ?? number;
  const order = slug === undefined || here === undefined ? [] : numbered(commands);
  const before = order.filter((other) => other.review_number! < here!).at(-1);
  const after = order.find((other) => other.review_number! > here!);
  const stepTo = (target: GameCommand | undefined) =>
    target === undefined || slug === undefined ? undefined : reviewPath(slug, target.review_number!);
  const nav =
    before !== undefined || after !== undefined
      ? {
          prev: <StepLink to={stepTo(before)} label="Previous question" icon="caretLeft" />,
          next: <StepLink to={stepTo(after)} label="Next question" icon="caretRight" />,
        }
      : undefined;

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
  // Latched, so a later refetch (each spoken turn asks for one) cannot drop the screen out of Saved mid-call.
  if (spokenSave && !saved) setSaved(true);

  // The Command's job is what gives the screen the app's voice support: the same build-chat voice target the composer
  // uses, naming this decision so the agent is briefed on it first. A Command without a job in hand keeps typing only.
  const { jobs } = useMyJobs();
  const voiceTarget = useMemo<Extract<DecisionVoiceTarget, { kind: 'build' }> | undefined>(() => {
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

  const answered = seen ?? command;
  // While a change is open the earlier answer is still on record, but the deck is what the creator is answering.
  if ((saved || spokenSave || (sentBefore && correcting === 0)) && answered !== undefined) {
    return (
      <ReviewFrame
        head={
          <>
            <h1>Saved</h1>
            {voice}
            <CloseButton onClose={back} />
          </>
        }
      >
        <div className="review-screen-body review-screen-steps">
          {nav?.prev}
          {/* A Command with no job answers through its game's own aiur, which cannot take a changed answer. */}
          {answered.job_id === null ? null : (
            <button
              className="review-screen-change tap-secondary"
              onClick={() => {
                // A correction starts from a fresh deck rather than the votes already sent.
                reopenDraft(answered);
                setSaved(false);
                setCorrecting((count) => count + 1);
              }}
              type="button"
            >
              Change
            </button>
          )}
          {nav?.next}
        </div>
      </ReviewFrame>
    );
  }

  if (shown === undefined) {
    return (
      <ReviewFrame
        head={
          <>
            <h1>Review</h1>
            <CloseButton onClose={back} />
          </>
        }
      >
        <p className="review-screen-state" role="status">
          {isPending ? 'Loading the review…' : 'That review is not open. It may already be answered.'}
        </p>
      </ReviewFrame>
    );
  }

  return (
    <ReviewFrame
      head={
        <>
          <h1>{reviewTitle(withoutLinks(shown.title))}</h1>
          {voice}
          <CloseButton onClose={back} />
        </>
      }
    >
      <div className="review-screen-body review-screen-deck">
        <ReviewDeck
          key={correcting}
          gameId={gameId}
          command={shown}
          onAnswered={() => {
            setSaved(true);
            setCorrecting(0);
          }}
        />
        <details className="review-screen-question">
          <summary>{withoutLinks(shown.question)}</summary>
        </details>
      </div>
    </ReviewFrame>
  );
}
