import type { ReactNode } from 'react';
import { Dialog } from '../Dialog';
import './glass.css';

/** Modal sheet reuses the app's focus trap and focus restoration. */
export function GlassDialog({ title, onClose, children }: { title: ReactNode; onClose(): void; children?: ReactNode }) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      className="ogm-glass-pane ogm-strong ogm-glass-sheet ogm-dialog"
      backdropClassName="ogm-glass-scrim"
    >
      {children}
    </Dialog>
  );
}
