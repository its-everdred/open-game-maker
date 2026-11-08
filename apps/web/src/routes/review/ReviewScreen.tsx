import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';

import { gamePath, reviewPath, type GameCommand } from '@ogm/contracts/browser';

import { findCommand, findCommandByNumber } from '../../features/commands-inbox/review-route';
import { withoutLinks } from '../../features/commands-inbox/review';
import { PlayLinkMessage } from '../play/PlayScreen';
import { playLinkDenial, usePlayLink } from '../play/api';
import { useGameCommands } from '../../features/commands-inbox/commands';
import { useIsSent, useServerDrafts } from '../../features/commands-inbox/drafts';
import { GlowBackdrop } from '../../features/commands-inbox/GlowBackdrop';
import { ReviewDeck } from '../../features/commands-inbox/ReviewDeck';
import { ReviewRows } from '../../features/commands-inbox/ReviewRows';
import { Icon } from '../../components/Icon';
import { reviewTitle } from './title';
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
        {isPending ? null : rows.length === 0 ? (
          <p className="review-screen-state" role="status">
            That review is not open. It may already be answered.
          </p>
        ) : (
          <ReviewRows commands={rows} hrefOf={(command) => reviewPath(slug, command.review_number!)} />
        )}
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
  const { commands, isPending } = useGameCommands(gameId);
  const command = find(commands);
  const [sentHere, setSent] = useState(false);
  // A review sent earlier (moved away from, then back to) stays sent: no second deck to answer it again.
  const sent = useIsSent(command) || sentHere;
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

  if (sent) {
    return (
      <ReviewFrame
        head={
          <>
            <h1>Review sent</h1>
            <CloseButton onClose={back} />
          </>
        }
      >
        {nav === undefined ? null : (
          <div className="review-screen-body review-screen-steps">
            {nav.prev}
            {nav.next}
          </div>
        )}
      </ReviewFrame>
    );
  }

  if (command === undefined) {
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
          <h1>{reviewTitle(withoutLinks(command.title))}</h1>
          <CloseButton onClose={back} />
        </>
      }
    >
      <div className="review-screen-body review-screen-deck">
        <ReviewDeck gameId={gameId} command={command} onAnswered={() => setSent(true)} />
        <details className="review-screen-question">
          <summary>{withoutLinks(command.question)}</summary>
        </details>
      </div>
    </ReviewFrame>
  );
}
