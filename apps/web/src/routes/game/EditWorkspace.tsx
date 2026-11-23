import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { FocusZone } from '../../lib/input';
import { EDITOR_FOCUS_ZONES } from '../../features/editor/focus';
import type { StreamedChatMessage } from '../../features/build-chat/stream';
import { Icon } from '../../components/Icon';
import { EditConversation } from './EditConversation';
import './edit-workspace.css';

type EditWorkspaceProps = {
  game: ReactNode;
  chat: ReactNode;
  editor?: ReactNode;
  editing?: boolean;
  /** Agent replies so far; a rise while the chat is closed marks the bubble unread. */
  replies?: number;
};

/** A drag down this far on the sheet's handle closes the chat. */
const SWIPE_CLOSE = 48;
/* The bubble's column at the right edge: its 16px inset plus its 50px width. */
const BUBBLE_COLUMN = 66;

/**
 * How far the host's touch controls rise from the bottom of the game in the bubble's column, so the bubble sits above
 * them. The host lays them out at fixed sizes (packages/host overlay.ts) and hides their layer on non-touch screens.
 */
function useTouchControlsRise() {
  const gameRef = useRef<HTMLDivElement>(null);
  const [rise, setRise] = useState(0);
  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;
    const measure = () => {
      const box = game.getBoundingClientRect();
      let top = box.bottom;
      for (const control of game.querySelectorAll('[data-action], [data-stick]')) {
        const rect = control.getBoundingClientRect();
        if (rect.height > 0 && rect.right > box.right - BUBBLE_COLUMN) top = Math.min(top, rect.top);
      }
      setRise(Math.max(0, Math.round(box.bottom - top)));
    };
    measure();
    /* Controls appear when the game loads, change with its inputs and hide after keyboard or pad input. */
    const mutations = new MutationObserver(measure);
    mutations.observe(game, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    resize?.observe(game);
    return () => {
      mutations.disconnect();
      resize?.disconnect();
    };
  }, []);
  return { gameRef, rise };
}

/** The game fills the page; the chat waits behind a bubble and opens as a sheet over the bottom. */
export function EditWorkspace({ game, chat, editor, editing = true, replies = 0 }: EditWorkspaceProps) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(replies);
  const { gameRef, rise } = useTouchControlsRise();
  const swipeFrom = useRef<number | undefined>(undefined);
  useEffect(() => {
    /* A new conversation restarts the count. */
    if (open || replies < seen) setSeen(replies);
  }, [open, replies, seen]);
  const unread = !open && replies > seen;
  return (
    <div
      className={editing ? 'edit-workspace' : 'edit-workspace is-playing'}
      style={{ '--edit-chat-rise': `${rise}px` } as CSSProperties}
    >
      <div className="edit-workspace-game" ref={gameRef}>
        {game}
      </div>
      {editing && (
        <div className="edit-workspace-chat" id="edit-chat" hidden={!open}>
          <div
            className="edit-workspace-chat-handle"
            aria-hidden="true"
            onPointerDown={(event) => {
              swipeFrom.current = event.clientY;
            }}
            onPointerUp={(event) => {
              if (swipeFrom.current !== undefined && event.clientY - swipeFrom.current >= SWIPE_CLOSE) setOpen(false);
              swipeFrom.current = undefined;
            }}
            onPointerCancel={() => {
              swipeFrom.current = undefined;
            }}
          />
          {chat}
        </div>
      )}
      {editing && (
        <button
          className="edit-workspace-chat-bubble"
          type="button"
          aria-label={unread ? 'Chat, new reply' : 'Chat'}
          aria-expanded={open}
          aria-controls="edit-chat"
          onClick={() => setOpen((was) => !was)}
        >
          <Icon name={open ? 'close' : 'chat'} />
          {unread && <span className="edit-workspace-chat-badge" />}
        </button>
      )}
      {editing && editor != null && (
        <details className="edit-workspace-editor">
          <summary aria-label="Game editor">✎</summary>
          <div className="edit-workspace-editor-content">{editor}</div>
        </details>
      )}
    </div>
  );
}

export function GameEditWorkspace({
  game,
  editor,
  conversation,
  editing,
}: {
  game: ReactNode;
  editor?: ReactNode;
  conversation: ComponentProps<typeof EditConversation>;
  editing: boolean;
}) {
  /* Only replies after the page opened count: a reconnect replays the job's earlier messages. */
  const [openedAt] = useState(() => Date.now());
  const [replies, setReplies] = useState(0);
  const countReplies = useCallback(
    (_jobId: string, messages: StreamedChatMessage[]) =>
      setReplies(messages.filter(({ actor, at }) => actor === 'agent' && Date.parse(at) >= openedAt).length),
    [openedAt],
  );
  return (
    <EditWorkspace
      game={game}
      editor={editor}
      editing={editing}
      replies={replies}
      chat={<EditConversation {...conversation} onMessages={countReplies} />}
    />
  );
}

export function EditPlayBar({ disabled, onPlay, saved }: { disabled: boolean; onPlay(): void; saved: string }) {
  return (
    <>
      <FocusZone id={EDITOR_FOCUS_ZONES.bar} className="editor-play-zone">
        <button className="editor-play-button" type="button" aria-label="Play" disabled={disabled} onClick={onPlay}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 3v18l14-9z" />
          </svg>
        </button>
      </FocusZone>
      <output className="sr" aria-live="polite">
        {saved}
      </output>
    </>
  );
}
