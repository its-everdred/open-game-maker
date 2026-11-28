import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { Link } from 'react-router';

import type { CreatorCommand, QuestionSession } from '@ogm/contracts/browser';

import { Icon } from '../../components/Icon';
import { openConversation } from '../build-chat/conversation';
import { useEnergy } from '../energy/api';
import type { WorkerBuild } from '../worker-builds/BuildTracker';
import type { ReviewCommand, ReviewTarget } from '../worker-builds/review-command';
import { ReviewInbox } from '../worker-builds/ReviewInbox';
import { TicketDetail } from '../worker-builds/TicketDetail';
import type { WorkerReview } from '../worker-builds/useWorkerReviews';
import { decisionSub, energyCards, resetText, type ReviewCard, type WorkRow, type WorkState } from './model';
import './game-menu.css';

const STATE_LABEL: Record<WorkState, string> = { wait: 'Waiting on you', work: 'Working', done: 'Done' };

export type EditMenuAction = { id: string; label: string; icon: string; disabled?: boolean; onSelect(): void };

type EditMenuProps = {
  open: boolean;
  onClose(): void;
  cards: readonly ReviewCard[];
  sessions: readonly QuestionSession[];
  /** This game's open decisions that are not review requests; each opens the decision deck. */
  decisions: readonly CreatorCommand[];
  rows: readonly WorkRow[];
  /** What the review inbox needs beyond the opened card. */
  inbox: {
    workers: WorkerBuild[];
    reviews: readonly WorkerReview[];
    commands: readonly ReviewCommand[];
    readOnlyReviewGames?: readonly string[];
    targets: readonly ReviewTarget[];
    error: boolean;
    incomplete: boolean;
  };
  creatorId?: string;
  gamePath: string;
  admin: boolean;
  signedIn: boolean;
  signingOut: boolean;
  actions: readonly EditMenuAction[];
  extras: readonly ReactElement[];
  onQuestions(session: QuestionSession): void;
  onDecision(command: CreatorCommand): void;
  /** Opens the owner's thread with the Executor; absent when the creator has none. */
  onAsk?: () => void;
  onSignOut(): void;
};

/**
 * The editor's game menu (#1326, Claude Design "Editor + Play Menus"): a paused modal with the reviews ready for the
 * creator first, the game's work and its agents next, Energy, then a quiet More. It stays mounted while closed so the
 * editor's tools and a game extra's pending work keep their place.
 */
export function EditMenu({
  open,
  onClose,
  cards,
  sessions,
  decisions,
  rows,
  inbox,
  creatorId,
  gamePath,
  admin,
  signedIn,
  signingOut,
  actions,
  extras,
  onQuestions,
  onDecision,
  onAsk,
  onSignOut,
}: EditMenuProps) {
  const resume = useRef<HTMLButtonElement>(null);
  const [more, setMore] = useState(false);
  const [review, setReview] = useState<ReviewCard>();
  const [detail, setDetail] = useState<WorkRow>();
  const reviewCount = cards.length + decisions.length + sessions.length;
  const ask = actions.find((action) => action.id === 'ask-change');

  useEffect(() => {
    if (open) {
      resume.current?.focus();
      return;
    }
    // Whatever closes the menu (a room's resume included) takes its review and ticket layers with it.
    setMore(false);
    setReview(undefined);
    setDetail(undefined);
  }, [open]);

  const empty = reviewCount === 0 && rows.length === 0;
  return (
    <div className="game-menu-shade" data-gm-overlay-allowed hidden={!open}>
      <div className="game-menu" role="dialog" aria-modal="true" aria-label="Paused">
        <div className="game-menu-head">
          <h2>Paused</h2>
          <button ref={resume} type="button" className="game-menu-circle is-go" aria-label="Resume" onClick={onClose}>
            <Icon name="play" className="is-solid" />
          </button>
        </div>
        <div className="game-menu-body is-edit">
          {empty ? (
            <div className="game-menu-empty" style={{ gridArea: 'a' }}>
              Nothing in progress
              {ask ? (
                <button
                  type="button"
                  className="game-menu-big is-go"
                  disabled={ask.disabled}
                  onClick={() => {
                    onClose();
                    ask.onSelect();
                  }}
                >
                  <Icon name="chat" />
                  {ask.label}
                </button>
              ) : null}
            </div>
          ) : null}
          {reviewCount > 0 ? (
            <section className="game-menu-sec" style={{ gridArea: 'a' }} aria-label="Review">
              <h3 className="game-menu-sh">
                Review<span className="game-menu-cnt">{reviewCount}</span>
              </h3>
              {cards.map((card) => (
                <button key={card.key} type="button" className="game-menu-rev" onClick={() => setReview(card)}>
                  {card.image ? <img src={card.image} alt="" /> : <span className="game-menu-rev-blank" />}
                  <span className="game-menu-rev-text">
                    <span className="game-menu-rev-title">{card.title}</span>
                    <span className="game-menu-rev-sub">{card.sub}</span>
                  </span>
                  <span className="game-menu-rev-go">Review</span>
                </button>
              ))}
              {decisions.map((command) => (
                <button
                  key={`decision:${command.decision_id}`}
                  type="button"
                  className="game-menu-rev"
                  onClick={() => onDecision(command)}
                >
                  <span className="game-menu-rev-blank">
                    <Icon name="chat" />
                  </span>
                  <span className="game-menu-rev-text">
                    <span className="game-menu-rev-title">{command.summary || command.title}</span>
                    <span className="game-menu-rev-sub">{decisionSub(command)}</span>
                  </span>
                  <span className="game-menu-rev-go">Review</span>
                </button>
              ))}
              {sessions.map((session) => (
                <button
                  key={`questions:${session.game_id}`}
                  type="button"
                  className="game-menu-rev"
                  aria-label={`Quick voice chat, ${session.count} questions`}
                  onClick={() => onQuestions(session)}
                >
                  <span className="game-menu-rev-blank">
                    <Icon name="mic" />
                  </span>
                  <span className="game-menu-rev-text">
                    <span className="game-menu-rev-title">Quick voice chat</span>
                    <span className="game-menu-rev-sub">{session.count}</span>
                  </span>
                  <span className="game-menu-rev-go">
                    <Icon name="mic" />
                  </span>
                </button>
              ))}
            </section>
          ) : null}
          {rows.length > 0 ? (
            <section className="game-menu-sec" style={{ gridArea: 'b' }} aria-label="Work">
              <h3 className="game-menu-sh">
                Work<span className="game-menu-cnt">{rows.length}</span>
              </h3>
              {rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  className="game-menu-row"
                  data-state={row.state}
                  onClick={() => (row.jobId ? openConversation(row.jobId) : setDetail(row))}
                >
                  <span className="game-menu-row-top">
                    {row.ticket ? <span className="game-menu-row-n">#{row.ticket}</span> : null}
                    <span className="game-menu-row-title">{row.title}</span>
                    {row.percent !== null ? <span className="game-menu-row-pct">{row.percent}%</span> : null}
                  </span>
                  <span
                    className="game-menu-bar"
                    role="progressbar"
                    aria-label={`${row.title} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={row.percent ?? undefined}
                  >
                    <span
                      data-unknown={row.percent === null || undefined}
                      style={{ width: `${row.percent ?? 30}%` } as CSSProperties}
                    />
                  </span>
                  <span className="game-menu-row-meta">
                    <span className="game-menu-pill">{STATE_LABEL[row.state]}</span>
                    {row.last ? <span className="game-menu-row-last">{row.last}</span> : null}
                  </span>
                </button>
              ))}
            </section>
          ) : null}
          {signedIn ? <EnergySection onClose={onClose} /> : null}
          <section className="game-menu-sec" style={{ gridArea: 'd' }}>
            <button
              type="button"
              className="game-menu-more"
              aria-expanded={more}
              aria-controls="game-menu-more"
              onClick={() => setMore(!more)}
            >
              <Icon name="more" />
              <span>More</span>
              <Icon name="caretRight" className="game-menu-chev" />
            </button>
            <div id="game-menu-more" className="game-menu-mlist" hidden={!more}>
              {actions
                .filter((action) => action.id !== 'ask-change' || !empty)
                .map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="game-menu-mi"
                    disabled={action.disabled}
                    onClick={() => {
                      onClose();
                      action.onSelect();
                    }}
                  >
                    <Icon name={action.icon} />
                    {action.label}
                  </button>
                ))}
              {onAsk ? (
                <button
                  type="button"
                  className="game-menu-mi"
                  onClick={() => {
                    onClose();
                    onAsk();
                  }}
                >
                  <Icon name="speak" />
                  Ask
                </button>
              ) : null}
              <Link className="game-menu-mi" to={`${gamePath}/releases?action=publish`} onClick={onClose}>
                <Icon name="publish" />
                Publish
              </Link>
              <Link className="game-menu-mi" to={`${gamePath}/versions`} onClick={onClose}>
                <Icon name="versions" />
                Versions
              </Link>
              <Link className="game-menu-mi" to={`${gamePath}/releases?action=rollback`} onClick={onClose}>
                <Icon name="rollback" />
                Rollback
              </Link>
              {signedIn ? (
                <Link className="game-menu-mi" to="/settings/credits" onClick={onClose}>
                  <Icon name="credits" />
                  Credits
                </Link>
              ) : null}
              {admin ? (
                <Link className="game-menu-mi" to="/admin" onClick={onClose}>
                  <Icon name="admin" />
                  Admin
                </Link>
              ) : null}
              {signedIn ? (
                <button type="button" className="game-menu-mi is-out" disabled={signingOut} onClick={onSignOut}>
                  <Icon name="signOut" />
                  Sign out
                </button>
              ) : null}
              {extras.length > 0 ? <div className="game-menu-extras">{extras}</div> : null}
            </div>
            {/* The editor's tools render here (EditorChrome looks the slot up when it mounts). */}
            <div id="studio-editor-tools" className="studio-editor-tools" hidden={!more} />
          </section>
        </div>
      </div>
      {review ? (
        <ReviewInbox
          workers={inbox.workers}
          reviews={inbox.reviews}
          commands={inbox.commands}
          readOnlyReviewGames={inbox.readOnlyReviewGames}
          initialReview={'review' in review ? review.review : undefined}
          initialCommand={'command' in review ? review.command : undefined}
          initialTarget={'target' in review ? review.target : undefined}
          targets={'target' in review ? [review.target] : []}
          error={inbox.error}
          incomplete={inbox.incomplete}
          onClose={() => setReview(undefined)}
        />
      ) : null}
      {detail?.ticket ? (
        <TicketDetail
          gameId={detail.gameId}
          ticket={detail.ticket}
          title={detail.title}
          creatorId={creatorId}
          onClose={() => setDetail(undefined)}
        />
      ) : null}
    </div>
  );
}

// Only a signed-in creator has Energy; the section stays out of the tree otherwise.
function EnergySection({ onClose }: { onClose(): void }) {
  const energy = useEnergy();
  const meters = energyCards(energy.data);
  if (meters.length === 0) return null;
  return (
    <section className="game-menu-sec" style={{ gridArea: 'c' }} aria-label="Minerals and Gas">
      <h3 className="game-menu-sh">Minerals and Gas</h3>
      <Link to="/settings/energy" className="game-menu-energy" aria-label="Minerals and Gas settings" onClick={onClose}>
        {meters.map((meter) => (
          <span key={meter.key} className="game-menu-en" data-high={(meter.usedPercent ?? 0) >= 80}>
            <span className="game-menu-en-top">
              {meter.name}
              <b>{meter.usedPercent === null ? '–' : `${meter.usedPercent}%`}</b>
            </span>
            <span className="game-menu-bar">
              <span style={{ width: `${meter.usedPercent ?? 0}%` }} />
            </span>
            <span className="game-menu-en-reset">{resetText(meter.resetsAt)}</span>
          </span>
        ))}
      </Link>
    </section>
  );
}
