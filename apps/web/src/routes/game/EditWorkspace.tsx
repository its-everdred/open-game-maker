import type { ReactNode } from 'react';
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
