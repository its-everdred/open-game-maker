import type { ComponentProps, ReactNode } from 'react';
import { FocusZone } from '../../lib/input';
import { EDITOR_FOCUS_ZONES } from '../../features/editor/focus';
import { EditConversation } from './EditConversation';
import './edit-workspace.css';

type EditWorkspaceProps = {
  game: ReactNode;
  chat: ReactNode;
  editor?: ReactNode;
  editing?: boolean;
};

/** Keep the game and conversation visible while optional game tools open over the game. */
export function EditWorkspace({ game, chat, editor, editing = true }: EditWorkspaceProps) {
  return (
    <div className={editing ? 'edit-workspace' : 'edit-workspace is-playing'}>
      <div className="edit-workspace-game">{game}</div>
      {editing && <div className="edit-workspace-chat">{chat}</div>}
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
  return <EditWorkspace game={game} editor={editor} editing={editing} chat={<EditConversation {...conversation} />} />;
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
