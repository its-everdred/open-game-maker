import type { ComponentProps, ReactNode } from 'react';
import { FocusZone } from '../../lib/input';
import { EDITOR_FOCUS_ZONES } from '../../features/editor/focus';
import { EditConversation } from './EditConversation';
import './edit-workspace.css';

type EditWorkspaceProps = {
  game: ReactNode;
  chat: ReactNode;
  editor?: ReactNode;
};

/** Keep the game and conversation visible while optional game tools open over the game. */
export function EditWorkspace({ game, chat, editor }: EditWorkspaceProps) {
  return (
    <div className="edit-workspace">
      <div className="edit-workspace-game">{game}</div>
      <div className="edit-workspace-chat">{chat}</div>
      {editor != null && (
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
}: {
  game: ReactNode;
  editor?: ReactNode;
  conversation: ComponentProps<typeof EditConversation>;
}) {
  return <EditWorkspace game={game} editor={editor} chat={<EditConversation {...conversation} />} />;
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
