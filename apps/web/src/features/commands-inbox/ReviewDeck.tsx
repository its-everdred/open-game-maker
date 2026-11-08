import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { GameCommand, VoiceTarget } from '@ogm/contracts';

import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { answerCommand } from './commands';
import { markSent, useDeckDraft } from './drafts';
import { answerOf, clipLength, deckCards, deckFinished, letterOf, mediaKindOf, reviewOf } from './review';
import { VoiceNote, type DictationPort } from './voice-note';
import './review-deck.css';
import './review-glass.css';

// The review deck (A3): a Command whose options carry media is judged one card at a time. Swiping right or tapping
// thumbs up likes the card, left or thumbs down dislikes it, and arrows do the same from the keyboard. A dislike opens
// a short reason note in the same tap. When the last card is judged the deck shows a compact grid of likes then
// dislikes; each card flips, and a Command that asks for one pick turns the likes into the shortlist to choose from.
// The answer goes back through the job's checkpoint route with the whole map, so aiur and the worker see it.
const SWIPE_DISTANCE = 56;

export function ReviewDeck({
  gameId,
  command,
  voiceTarget,
  dictation,
  nav,
  onAnswered,
}: {
  gameId: string;
  command: GameCommand;
  // The Command's job gives the deck the app's voice support for the whole-set notes; without it the notes are typed.
  voiceTarget?: VoiceTarget;
  dictation?: DictationPort;
  // The review screen's previous and next arrows, which flank Send so the title keeps the header to itself.
  nav?: { prev: ReactNode; next: ReactNode };
  onAnswered?(): void;
}) {
  const [state, dispatch] = useDeckDraft(command);
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState(0);
  const notesId = useId();
  // The card whose still, GIF or clip is open full screen. The operator asked for every sample to show whole, so a tap
  // on the media opens it at the phone's full size over the deck.
  const [fullscreen, setFullscreen] = useState<string | null>(null);

  const cards = deckCards(command);
  const card = cards[state.cards.length];
  const onePick = command.pick !== 'many';
  // A one-pick deck with several likes and no pick has no answer yet: Send then opens the ending grid, where tapping a
  // like chooses it and sends. Guessing the first like would answer with a card the creator never chose.
  const mustChoose =
    onePick && state.picked === null && state.cards.filter(({ verdict }) => verdict === 'like').length > 1;
  const [choosing, setChoosing] = useState(false);
  const finished = deckFinished(command, state) || choosing;
  const fullscreenCard = fullscreen === null ? undefined : cards.find(({ id }) => id === fullscreen);
  const fullscreenView =
    fullscreenCard === undefined ? null : <MediaFullscreen card={fullscreenCard} onClose={() => setFullscreen(null)} />;

  const judge = useCallback(
    (verdict: 'like' | 'dislike') => {
      if (card === undefined) return;
      dispatch({ type: 'judge', optionId: card.id, verdict });
    },
    [card, dispatch],
  );

  const answer = useCallback(
    async (optionId: string) => {
      dispatch({ type: 'sending' });
      setError(undefined);
      try {
        await answerCommand(gameId, command, optionId, reviewOf(state));
        dispatch({ type: 'sent' });
        markSent(command);
        onAnswered?.();
      } catch {
        // The Command stays in the inbox: the route's status (409 for a Command another writer answered) is final.
        dispatch({ type: 'sent' });
        setError('The review did not send. Try again.');
      }
    },
    [command, dispatch, gameId, onAnswered, state],
  );
  // Send is always on: a half-judged deck sends what it has, the same answer the ending grid would send. On the ending
  // grid of a one-pick deck that still needs its choice, the likes' chips are the send.
  const sendButton = (
    <div className="review-deck-send-row">
      {nav?.prev}
      {finished && mustChoose ? null : (
        <button
          aria-label="Send the review"
          className="review-deck-send"
          disabled={state.sending}
          onClick={() => (mustChoose ? setChoosing(true) : void answer(answerOf(command, state).option_id))}
          type="button"
        >
          <Icon name="send" />
        </button>
      )}
      {nav?.next}
    </div>
  );

  if (state.reason !== null) {
    const target = cards.find(({ id }) => id === state.reason!.optionId);
    return (
      <ReasonSheet
        label={target?.label ?? ''}
        text={state.reason.text}
        onChange={(text) => dispatch({ type: 'set-reason', text })}
        onClose={() => dispatch({ type: 'close-reason' })}
      />
    );
  }

  if (!finished && card !== undefined) {
    return (
      <>
        <section
          aria-label={`Review ${command.title}`}
          className="review-deck"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              judge('like');
            }
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              judge('dislike');
            }
          }}
        >
          <DeckCard
            card={card}
            letter={letterOf(cards, card.id)}
            drag={drag}
            onDrag={setDrag}
            onDragEnd={(dx) => {
              setDrag(0);
              if (dx >= SWIPE_DISTANCE) judge('like');
              else if (dx <= -SWIPE_DISTANCE) judge('dislike');
            }}
            onTap={() => setFullscreen(card.id)}
          />
          <div className="review-deck-actions">
            <button
              aria-label="Dislike"
              className="review-deck-thumb tap-secondary"
              disabled={state.sending}
              onClick={() => judge('dislike')}
              type="button"
            >
              <Icon name="thumbsDown" />
            </button>
            <button
              aria-label="Undo the last swipe"
              className="review-deck-undo tap-secondary"
              disabled={state.cards.length === 0 || state.sending}
              onClick={() => dispatch({ type: 'undo' })}
              type="button"
            >
              <Icon name="rollback" />
            </button>
            <button
              aria-label="Like"
              className="review-deck-thumb tap-secondary"
              disabled={state.sending}
              onClick={() => judge('like')}
              type="button"
            >
              <Icon name="thumbsUp" />
            </button>
          </div>
          <p aria-live="polite" className="review-deck-progress">
            {state.cards.length + 1} of {cards.length}
          </p>
          {sendButton}
          {error === undefined ? null : (
            <p className="review-deck-error" role="alert">
              {error}
            </p>
          )}
        </section>
        {fullscreenView}
      </>
    );
  }

  const likes = state.cards.filter(({ verdict }) => verdict === 'like');
  const dislikes = state.cards.filter(({ verdict }) => verdict === 'dislike');
  return (
    <>
      <section aria-label={`Review ${command.title}`} className="review-deck review-deck-ended">
        <h3 className="review-deck-heading">Likes</h3>
        <ul aria-label="Likes" className="review-deck-grid">
          {likes.length === 0 ? <li className="review-deck-empty">Nothing liked yet</li> : null}
          {likes.map(({ optionId }) => (
            <li key={optionId}>
              <MediaThumb option={optionOf(cards, optionId)} onOpen={() => setFullscreen(optionId)} />
              <button
                aria-label={onePick ? `Choose ${labelOf(cards, optionId)}` : `Dislike ${labelOf(cards, optionId)}`}
                className="review-deck-chip"
                disabled={state.sending}
                onClick={() => (onePick ? void answer(optionId) : dispatch({ type: 'flip', optionId }))}
                type="button"
              >
                <span className="review-deck-chip-label">{letterOf(cards, optionId)}</span>
              </button>
            </li>
          ))}
        </ul>
        <h3 className="review-deck-heading">Dislikes</h3>
        <ul aria-label="Dislikes" className="review-deck-grid">
          {dislikes.length === 0 ? <li className="review-deck-empty">Nothing disliked yet</li> : null}
          {dislikes.map(({ optionId, reason }) => (
            <li key={optionId}>
              <MediaThumb option={optionOf(cards, optionId)} onOpen={() => setFullscreen(optionId)} />
              <button
                aria-label={`Like ${labelOf(cards, optionId)}`}
                className="review-deck-chip review-deck-chip-dislike"
                disabled={state.sending}
                onClick={() => dispatch({ type: 'flip', optionId })}
                type="button"
              >
                <span className="review-deck-chip-label">{letterOf(cards, optionId)}</span>
              </button>
              <button
                aria-label={`${reason === undefined ? 'Add' : 'Edit'} a reason for ${labelOf(cards, optionId)}`}
                className="review-deck-chip-reason tap-secondary"
                disabled={state.sending}
                onClick={() => dispatch({ type: 'open-reason', optionId })}
                type="button"
              >
                {reason === undefined ? 'Reason' : reason}
              </button>
            </li>
          ))}
        </ul>
        {/* The creator's set-level words: one optional note that applies to every card, typed or spoken where the app
            has voice support. It rides in the answer beside the per-card votes. */}
        <div className="review-deck-notes">
          <label className="review-deck-notes-label" htmlFor={notesId}>
            Anything else about the set?
          </label>
          <textarea
            id={notesId}
            disabled={state.sending}
            maxLength={2000}
            onChange={(event) => dispatch({ type: 'set-notes', text: event.target.value })}
            placeholder="Optional. This applies to all the cards."
            rows={3}
            value={state.notes}
          />
          <VoiceNote
            target={voiceTarget}
            dictation={dictation}
            onText={(text) => dispatch({ type: 'set-notes', text })}
          />
        </div>
        {sendButton}
        {error === undefined ? null : (
          <p className="review-deck-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {fullscreenView}
    </>
  );
}

// Whether the deck takes over a Command in the inbox: every option is a card carrying media (audio, image, GIF or
// video), which is what the deck judges one at a time. A Command with mixed options keeps the plain option list —
// its text choice is not a card — and the deep link still opens it in the deck.
export function isReviewDeck(command: GameCommand): boolean {
  return command.options.every(({ media }) => media !== undefined);
}

function labelOf(cards: GameCommand['options'], optionId: string): string {
  return optionOf(cards, optionId)?.label ?? optionId;
}

function optionOf(cards: GameCommand['options'], optionId: string): GameCommand['options'][number] | undefined {
  return cards.find(({ id }) => id === optionId);
}

// A swipe is a gesture; a tap is not. The card only opens the full-screen view when the pointer travelled less than a
// few pixels, so judging a card by dragging never opens a viewer and a tap never judges the card.
const TAP_SLOP = 4;

function DeckCard({
  card,
  letter,
  drag,
  onDrag,
  onDragEnd,
  onTap,
}: {
  card: GameCommand['options'][number];
  letter: string;
  drag: number;
  onDrag(dx: number): void;
  onDragEnd(dx: number): void;
  onTap(): void;
}) {
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const media = card.media;
  const kind = media === undefined ? 'image' : mediaKindOf(media);

  // An audio card starts as soon as it appears, and a tap on the card hears it again. Browsers refuse a programmatic
  // play without a gesture and jsdom has no media engine, so a refused play leaves the replay button as the way in.
  useEffect(() => {
    if (kind !== 'audio') return;
    setPlaying(false);
    play(audio.current, setPlaying);
  }, [kind, media?.url]);

  return (
    <div
      className="review-deck-card"
      style={{ transform: drag === 0 ? undefined : `translateX(${drag}px)` }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        // The replay control and the label keep their own taps; only the sample itself opens the viewer.
        if ((event.target as HTMLElement).closest('button') !== null) return;
        start.current = { x: event.clientX, y: event.clientY };
        capturePointer(event.currentTarget, event.pointerId);
      }}
      onPointerMove={(event) => {
        if (start.current === undefined) return;
        onDrag(event.clientX - start.current.x);
      }}
      onPointerUp={(event) => {
        if (start.current === undefined) return;
        const dx = event.clientX - start.current.x;
        const dy = event.clientY - start.current.y;
        start.current = undefined;
        onDragEnd(dx);
        if (Math.abs(dx) >= TAP_SLOP || Math.abs(dy) >= TAP_SLOP) return;
        // A tap plays an audio card; a still, GIF or clip opens its whole sample full screen.
        if (kind === 'audio') play(audio.current, setPlaying);
        else onTap();
      }}
      onPointerCancel={() => {
        start.current = undefined;
        onDragEnd(0);
      }}
    >
      {media === undefined ? null : kind === 'audio' ? (
        <AudioCard audio={audio} label={card.label} playing={playing} setPlaying={setPlaying} src={media.url} />
      ) : kind === 'video' ? (
        <video
          aria-label={card.label}
          className="review-deck-media"
          muted
          playsInline
          poster={media.poster}
          preload="metadata"
          src={media.url}
          style={{ aspectRatio: `${media.width} / ${media.height}` }}
        />
      ) : (
        <img
          alt={card.label}
          className="review-deck-media"
          src={media.url}
          style={{ aspectRatio: `${media.width} / ${media.height}` }}
        />
      )}
      {/* Few words on a card: its letter, with the option's own label as the media's accessible name. A card
          with no media is its words, so it shows them. */}
      <p className="review-deck-label" aria-hidden={media === undefined ? undefined : 'true'}>
        {media === undefined ? card.label : letter}
      </p>
      {/* An audio card has no still to show, so its card says how long the sample runs beside the replay control. */}
      {kind === 'audio' && media?.duration_ms !== undefined ? (
        <p className="review-deck-length">{clipLength(media.duration_ms)}</p>
      ) : null}
    </div>
  );
}

// The ending grid shows the whole sample too: a thumbnail that opens the same full-screen view. An audio card has no
// still to show, so its grid entry is the label chip alone.
function MediaThumb({ option, onOpen }: { option: GameCommand['options'][number] | undefined; onOpen(): void }) {
  const media = option?.media;
  if (option === undefined || media === undefined || mediaKindOf(media) === 'audio') return null;
  return (
    <button
      aria-label={`Open ${option.label} full screen`}
      className="review-deck-thumb-media"
      onClick={onOpen}
      type="button"
    >
      <img
        alt={option.label}
        src={media.poster ?? media.url}
        style={{ aspectRatio: `${media.width} / ${media.height}` }}
      />
    </button>
  );
}

// The whole sample at the phone's full size, over the studio's scrim. A clip gets controls here; a still or GIF fills
// the width and is contained, never cropped. Escape or Close returns to the deck.
function MediaFullscreen({ card, onClose }: { card: GameCommand['options'][number]; onClose(): void }) {
  const media = card.media;
  if (media === undefined) return null;
  // An audio sample has no still to fill the screen with; its card's tap replays it instead of opening this viewer.
  if (mediaKindOf(media) === 'audio') return null;
  return (
    <Dialog
      title={card.label}
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

// An audio card plays as soon as it appears and offers one tap to hear it again; the card's length sits beside the
// replay control so a long take can be judged without playing all of it. Browsers refuse a programmatic play without a
// gesture and jsdom has no media engine, so a refused or missing play leaves the replay button as the way in.
function AudioCard({
  audio,
  label,
  playing,
  setPlaying,
  src,
}: {
  audio: React.RefObject<HTMLAudioElement | null>;
  label: string;
  playing: boolean;
  setPlaying(playing: boolean): void;
  src: string;
}) {
  return (
    <div className="review-deck-audio">
      <audio
        aria-label={label}
        onEnded={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        preload="auto"
        ref={audio}
        src={src}
      />
      <button
        aria-label={`Replay ${label}`}
        className="review-deck-replay tap-secondary"
        onClick={() => {
          const element = audio.current;
          if (element === null) return;
          element.currentTime = 0;
          play(element, setPlaying);
        }}
        type="button"
      >
        <Icon name={playing ? 'soundOn' : 'soundOff'} />
      </button>
    </div>
  );
}

function play(element: HTMLAudioElement | null, report: (playing: boolean) => void): void {
  if (element === null) return;
  try {
    const started = element.play();
    void started?.then(
      () => report(true),
      () => report(false),
    );
  } catch {
    report(false);
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
