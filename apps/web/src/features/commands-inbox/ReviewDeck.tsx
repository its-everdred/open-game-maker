import { useCallback, useEffect, useRef, useState } from 'react';

import type { GameCommand } from '@ogm/contracts';

import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { answerCommand } from './commands';
import { markSent, saveDraft, useDeckDraft, useServerDrafts } from './drafts';
import { answerOf, clipLength, deckCards, deckFinished, letterOf, mediaKindOf, withoutLinks } from './review';
import { PlayableCard } from './playable';
import './review-deck.css';
import './review-glass.css';

// The review deck (A3): a Command whose options carry media is judged one card at a time. Swiping right or tapping
// thumbs up likes the card, left or thumbs down dislikes it, and arrows do the same from the keyboard. A dislike opens
// a short reason note in the same tap. Each vote is saved on the server as it is cast, and once every card has one the
// deck answers the Command with the whole map (#631): there is no Send. The answer goes back through the job's
// Command route, or the game's own route for a Command no job owns, so aiur and the worker see it.

type Card = GameCommand['options'][number];
type Verdict = 'like' | 'dislike';

export function ReviewDeck({
  gameId,
  command,
  onAnswered,
}: {
  gameId: string;
  command: GameCommand;
  onAnswered?(): void;
}) {
  useServerDrafts(gameId);
  const [state, dispatch] = useDeckDraft(command);
  const [error, setError] = useState<string>();
  // The card on its way off screen after a vote; that card is judged once it has gone, even if the deck changed
  // under it meanwhile (votes cast on another device arriving).
  const [leaving, setLeaving] = useState<{ optionId: string; verdict: Verdict } | null>(null);
  // The card whose still, GIF or clip is open full screen.
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const sound = useDeckSound();
  const { play, stop } = sound;

  const cards = deckCards(command);
  const card = cards[state.cards.length];
  const next = cards[state.cards.length + 1];
  const complete = deckFinished(command, state) && state.reason === null;
  const fullscreenCard = fullscreen === null ? undefined : cards.find(({ id }) => id === fullscreen);

  // Each vote, reason and undo is saved as it happens, so leaving midway keeps the votes.
  useEffect(() => {
    saveDraft(gameId, command, state);
  }, [command, gameId, state]);

  // The card's voice starts when it appears. A browser that wants a gesture first refuses this play; the vote that
  // brought the card in has already started it (see `vote`), and a tap on the card plays it again.
  const cardSound = card === undefined ? undefined : soundOf(card);
  useEffect(() => {
    if (cardSound === undefined) stop();
    else play(cardSound);
  }, [cardSound, play, stop]);

  // Once every card has a vote the Command is answered with the whole map. A failed answer is not retried on its own;
  // undoing a vote and casting it again (or reloading) tries again.
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!complete || state.sending) return;
    const { option_id, review } = answerOf(command, state);
    const signature = JSON.stringify({ option_id, review });
    if (tried.current === signature) return;
    tried.current = signature;
    dispatch({ type: 'sending' });
    setError(undefined);
    answerCommand(gameId, command, option_id, review).then(
      () => {
        dispatch({ type: 'sent' });
        markSent(command);
        onAnswered?.();
      },
      () => {
        // The Command stays in the inbox: the route's status (409 for a Command another writer answered) is final.
        dispatch({ type: 'sent' });
        setError('The review did not send. Undo a vote and cast it again to retry.');
      },
    );
  }, [command, complete, dispatch, gameId, onAnswered, state]);

  // A vote from a button, a key or a swipe. The next card's voice starts here, inside the gesture, because a phone
  // browser only lets sound start from one; the card then flies off and is judged once it has gone.
  const vote = useCallback(
    (verdict: Verdict) => {
      if (card === undefined || leaving !== null || state.sending) return;
      const nextSound = next === undefined ? undefined : soundOf(next);
      if (nextSound === undefined) stop();
      else play(nextSound);
      if (prefersReducedMotion()) dispatch({ type: 'judge', optionId: card.id, verdict });
      else setLeaving({ optionId: card.id, verdict });
    },
    [card, dispatch, leaving, next, play, state.sending, stop],
  );

  useEffect(() => {
    if (leaving === null) return;
    const timer = window.setTimeout(() => {
      setLeaving(null);
      dispatch({ type: 'judge', ...leaving });
    }, FLY_MS);
    return () => window.clearTimeout(timer);
  }, [dispatch, leaving]);

  const reasonCard = state.reason === null ? undefined : cards.find(({ id }) => id === state.reason!.optionId);
  return (
    <>
      <section
        aria-label={`Review ${command.title}`}
        className="review-deck"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            vote('like');
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            vote('dislike');
          }
          if ((event.key === 'Enter' || event.key === ' ') && cardSound !== undefined) {
            event.preventDefault();
            sound.replay(cardSound);
          }
        }}
      >
        {sound.element}
        <div className="review-deck-stage">
          {card === undefined ? null : (
            <DeckCard
              key={card.id}
              gameId={gameId}
              cards={cards}
              card={card}
              letter={letterOf(cards, card.id)}
              playing={sound.playing && cardSound !== undefined && sound.src === cardSound}
              leaving={leaving?.optionId === card.id ? leaving.verdict : null}
              onRelease={vote}
              onTap={() => {
                if (cardSound !== undefined) sound.replay(cardSound);
                else setFullscreen(card.id);
              }}
            />
          )}
        </div>
        <div className="review-deck-side">
          <div className="review-deck-actions">
            <button
              aria-label="Undo the last swipe"
              className="review-deck-undo tap-secondary"
              disabled={state.cards.length === 0 || state.sending || leaving !== null}
              onClick={() => {
                const back = state.cards.at(-1);
                const backCard = back === undefined ? undefined : cards.find(({ id }) => id === back.optionId);
                const backSound = backCard === undefined ? undefined : soundOf(backCard);
                if (backSound !== undefined) sound.play(backSound);
                setError(undefined);
                tried.current = null;
                dispatch({ type: 'undo' });
              }}
              type="button"
            >
              <Icon name="rollback" />
            </button>
            <button
              aria-label="Dislike"
              className="review-deck-thumb tap-secondary"
              disabled={card === undefined || state.sending}
              onClick={() => vote('dislike')}
              type="button"
            >
              <Icon name="thumbsDown" />
            </button>
            <button
              aria-label="Like"
              className="review-deck-thumb tap-secondary"
              disabled={card === undefined || state.sending}
              onClick={() => vote('like')}
              type="button"
            >
              <Icon name="thumbsUp" />
            </button>
          </div>
          <p aria-live="polite" className="review-deck-progress">
            {Math.min(state.cards.length + 1, cards.length)} of {cards.length}
          </p>
        </div>
        {error === undefined ? null : (
          <p className="review-deck-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {fullscreenCard === undefined ? null : (
        <MediaFullscreen card={fullscreenCard} onClose={() => setFullscreen(null)} />
      )}
      {/* The reason sheet sits over the deck rather than replacing it, so the next card's voice keeps playing. */}
      {state.reason === null ? null : (
        <ReasonSheet
          label={withoutLinks(reasonCard?.label ?? '')}
          text={state.reason.text}
          onChange={(text) => dispatch({ type: 'set-reason', text })}
          onClose={() => dispatch({ type: 'close-reason' })}
        />
      )}
    </>
  );
}

// Whether the deck takes over a Command in the inbox: every option is a card carrying media (audio, image, GIF or
// video), which is what the deck judges one at a time. A Command with mixed options keeps the plain option list —
// its text choice is not a card — and the deep link still opens it in the deck.
export function isReviewDeck(command: GameCommand): boolean {
  return command.options.every(({ media, playable }) => media !== undefined || playable !== undefined);
}

// The sound a card plays: a character card's voice beside its portrait, or the card's own sample when it is a sound.
function soundOf(card: Card): string | undefined {
  if (card.playable !== undefined) return undefined;
  if (card.audio !== undefined) return card.audio.url;
  return card.media !== undefined && mediaKindOf(card.media) === 'audio' ? card.media.url : undefined;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// One audio element for the whole deck. A phone browser lets an element play from code once a gesture has played it,
// so keeping the same element from card to card lets each voice start as its card appears. jsdom has no media engine
// and a browser may refuse a play; either leaves the card's tap as the way in.
function useDeckSound() {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [src, setSrc] = useState<string>();
  const load = useCallback((url: string): HTMLAudioElement | null => {
    const element = ref.current;
    if (element !== null && element.getAttribute('src') !== url) {
      element.setAttribute('src', url);
      setSrc(url);
    }
    return element;
  }, []);
  // Starts the sound unless it is already playing.
  const play = useCallback(
    (url: string) => {
      const element = load(url);
      if (element !== null && element.paused) start(element);
    },
    [load],
  );
  // Plays the sound again from its start.
  const replay = useCallback(
    (url: string) => {
      const element = load(url);
      if (element === null) return;
      element.currentTime = 0;
      start(element);
    },
    [load],
  );
  const stop = useCallback(() => ref.current?.pause(), []);
  const element = (
    <audio
      onEnded={() => setPlaying(false)}
      onPause={() => setPlaying(false)}
      onPlay={() => setPlaying(true)}
      preload="auto"
      ref={ref}
    />
  );
  return { element, playing, src, play, replay, stop };
}

function start(element: HTMLAudioElement): void {
  try {
    void element.play()?.catch(() => undefined);
  } catch {
    // jsdom has no media engine.
  }
}

// A swipe is a gesture; a tap is not. The card only counts a tap when the pointer travelled less than a few pixels, so
// judging a card by dragging never plays or opens it and a tap never judges it.
const TAP_SLOP = 6;
// Past this share of the card's width, or flicked faster than this, a released card flies off; otherwise it springs
// back. The tilt follows the drag: a few degrees per hundred pixels, up to a limit.
const SWIPE_SHARE = 0.28;
const FLICK_SPEED = 0.6;
const TILT_PER_PX = 0.06;
const MAX_TILT = 18;
const FLY_MS = 240;

function DeckCard({
  gameId,
  cards,
  card,
  letter,
  playing,
  leaving,
  onRelease,
  onTap,
}: {
  gameId: string;
  cards: GameCommand['options'];
  card: Card;
  letter: string;
  playing: boolean;
  leaving: Verdict | null;
  onRelease(verdict: Verdict): void;
  onTap(): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const likeStamp = useRef<HTMLSpanElement>(null);
  const dislikeStamp = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; t: number; dx: number; dy: number; moved: boolean }>(
    undefined,
  );
  const frame = useRef(0);
  const media = card.media;
  const kind = media === undefined ? 'image' : mediaKindOf(media);
  const sound = card.audio ?? (kind === 'audio' ? media : undefined);

  // The drag writes the card's transform directly, once per frame, so following the finger never waits on a render.
  const place = (dx: number, dy: number, animate: boolean) => {
    const node = element.current;
    if (node === null) return;
    const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, dx * TILT_PER_PX));
    node.style.transition = animate ? '' : 'none';
    node.style.transform = dx === 0 && dy === 0 ? '' : `translate(${dx}px, ${dy}px) rotate(${tilt}deg)`;
    const reach = Math.min(1, Math.abs(dx) / threshold(node));
    if (likeStamp.current !== null) likeStamp.current.style.opacity = dx > 0 ? String(reach) : '0';
    if (dislikeStamp.current !== null) dislikeStamp.current.style.opacity = dx < 0 ? String(reach) : '0';
  };

  // A vote from a button, a key or a released swipe sends the card off the side it was voted to, stamped; the deck
  // judges it once the flight is over.
  useEffect(() => {
    const node = element.current;
    if (leaving === null || node === null) return;
    const away = (leaving === 'like' ? 1 : -1) * (window.innerWidth + node.offsetWidth);
    const dy = drag.current?.dy ?? 0;
    node.style.transition = `transform ${FLY_MS}ms ease-in`;
    node.style.transform = `translate(${away}px, ${dy}px) rotate(${(leaving === 'like' ? 1 : -1) * MAX_TILT * 1.5}deg)`;
    const stamp = leaving === 'like' ? likeStamp.current : dislikeStamp.current;
    if (stamp !== null) stamp.style.opacity = '1';
  }, [leaving]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return (
    <div
      className="review-deck-card"
      data-kind={card.playable !== undefined ? 'playable' : media === undefined ? 'text' : kind}
      ref={element}
      style={
        media !== undefined && kind !== 'audio' && card.playable === undefined
          ? ({ '--ar': `${media.width / media.height}` } as React.CSSProperties)
          : undefined
      }
      onPointerDown={(event) => {
        if (leaving !== null) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        // A playable slice keeps every touch for the game.
        if ((event.target as HTMLElement).closest('button, .review-deck-playable') !== null) return;
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          t: event.timeStamp,
          dx: 0,
          dy: 0,
          moved: false,
        };
        capturePointer(event.currentTarget, event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current === undefined || current.id !== event.pointerId) return;
        current.dx = event.clientX - current.x;
        current.dy = event.clientY - current.y;
        if (!current.moved && Math.hypot(current.dx, current.dy) < TAP_SLOP) return;
        current.moved = true;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => place(current.dx, current.dy, false));
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        if (current === undefined || current.id !== event.pointerId) return;
        cancelAnimationFrame(frame.current);
        const dx = event.clientX - current.x;
        current.dy = event.clientY - current.y;
        if (!current.moved && Math.hypot(dx, current.dy) < TAP_SLOP) {
          drag.current = undefined;
          onTap();
          return;
        }
        const speed = Math.abs(dx) / Math.max(1, event.timeStamp - current.t);
        const node = event.currentTarget;
        if (Math.abs(dx) >= threshold(node) || (speed >= FLICK_SPEED && Math.abs(dx) >= TAP_SLOP * 4)) {
          onRelease(dx > 0 ? 'like' : 'dislike');
          return;
        }
        drag.current = undefined;
        place(0, 0, true);
      }}
      onPointerCancel={() => {
        cancelAnimationFrame(frame.current);
        drag.current = undefined;
        place(0, 0, true);
      }}
    >
      {/* A playable option is played even when it also carries a still; keyed by the card so its slice, pause and
          compare state never carry over to the next card. */}
      {card.playable !== undefined ? (
        <PlayableCard key={card.id} gameId={gameId} card={card} options={cards} />
      ) : media === undefined ? null : kind === 'audio' ? (
        <div aria-label={card.label} className="review-deck-audio" role="img">
          <Icon name={playing ? 'soundOn' : 'soundOff'} />
        </div>
      ) : kind === 'video' ? (
        <video
          aria-label={card.label}
          className="review-deck-media"
          muted
          playsInline
          poster={media.poster}
          preload="metadata"
          src={media.url}
        />
      ) : (
        <img alt={card.label} className="review-deck-media" draggable={false} src={media.url} />
      )}
      {/* Few words on a card: its letter, with the option's own label as the media's accessible name. A card
          with no media is its words, so it shows them. */}
      <p className="review-deck-label" aria-hidden={media === undefined ? undefined : 'true'}>
        {media === undefined ? withoutLinks(card.label) : letter}
      </p>
      {/* A card with a sound says how long it runs, and shows whether it is playing when a picture fills the card. */}
      {sound === undefined || card.playable !== undefined ? null : (
        <p className="review-deck-length">
          {kind === 'audio' ? null : <Icon name={playing ? 'soundOn' : 'soundOff'} />}
          {sound.duration_ms === undefined ? null : clipLength(sound.duration_ms)}
        </p>
      )}
      <span aria-hidden="true" className="review-deck-stamp review-deck-stamp-like" ref={likeStamp}>
        <Icon name="thumbsUp" />
      </span>
      <span aria-hidden="true" className="review-deck-stamp review-deck-stamp-dislike" ref={dislikeStamp}>
        <Icon name="thumbsDown" />
      </span>
    </div>
  );
}

function threshold(node: HTMLElement): number {
  return Math.max(72, node.offsetWidth * SWIPE_SHARE);
}

// The whole sample at the phone's full size, over the studio's scrim. A clip gets controls here; a still or GIF fills
// the width and is contained, never cropped. Escape or Close returns to the deck.
function MediaFullscreen({ card, onClose }: { card: Card; onClose(): void }) {
  const media = card.media;
  if (media === undefined || mediaKindOf(media) === 'audio') return null;
  return (
    <Dialog
      title={withoutLinks(card.label)}
      className="review-deck-fullscreen"
      backdropClassName="review-deck-fullscreen-backdrop"
      onClose={onClose}
    >
      {mediaKindOf(media) === 'video' ? (
        <video aria-label={card.label} controls playsInline poster={media.poster} src={media.url} />
      ) : (
        <img alt={card.label} src={media.url} />
      )}
      <button aria-label="Close" className="review-deck-fullscreen-close tap-secondary" onClick={onClose} type="button">
        Close
      </button>
    </Dialog>
  );
}

// Pointer capture is optional in embedded and test browsers, so a refusal leaves the swipe to the card's own bounds.
function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer capture is optional in embedded and test browsers.
  }
}

// The reason note: a short text the creator writes about one dislike. It is optional, so closing it without typing
// leaves the dislike as a plain swipe.
function ReasonSheet({
  label,
  text,
  onChange,
  onClose,
}: {
  label: string;
  text: string;
  onChange(value: string): void;
  onClose(): void;
}) {
  const [notice, setNotice] = useState<string>();
  return (
    <Dialog
      title={`Why did you dislike “${label}”?`}
      className="review-deck-reason"
      backdropClassName="review-deck-reason-backdrop"
      onClose={onClose}
    >
      <textarea
        aria-label={`Reason for disliking ${label}`}
        maxLength={1000}
        onChange={(event) => onChange(event.target.value)}
        placeholder="One short reason"
        rows={3}
        value={text}
      />
      {notice === undefined ? null : <p role="status">{notice}</p>}
      <div className="review-deck-reason-actions">
        <button className="tap-secondary" onClick={onClose} type="button">
          Skip
        </button>
        <button
          className="review-deck-reason-save"
          onClick={() => {
            if (text.trim() === '') setNotice('A reason needs a few words, or skip it.');
            else onClose();
          }}
          type="button"
        >
          Add the reason
        </button>
      </div>
    </Dialog>
  );
}
