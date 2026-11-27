import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Icon } from '../../components/Icon';
import { MenuRing } from '../../components/MenuCircle';
import { sendReport } from './send';
import './bug.css';

export function BugButton({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className="menu-circle"
      aria-label="Report a problem"
      aria-expanded={open}
      aria-controls="bug-sheet"
      onClick={onToggle}
    >
      <MenuRing />
      <Icon name="bug" />
    </button>
  );
}

export type BugDraft = ReturnType<typeof useBugDraft>;

// The draft lives with the menu, not the sheet, so switching to another circle mid-send keeps the text and the result.
export function useBugDraft() {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'failed'>('idle');
  const [energyReset, setEnergyReset] = useState<string>();
  return { text, setText, state, setState, energyReset, setEnergyReset };
}

export function BugSheet({ draft, close }: { draft: BugDraft; close(): void }) {
  const { text, setText, state, setState, energyReset, setEnergyReset } = draft;
  const resetRef = useRef(energyReset);
  resetRef.current = energyReset;
  useEffect(
    () => () => {
      if (resetRef.current !== undefined) setEnergyReset(undefined);
    },
    [setEnergyReset],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    try {
      const result = await sendReport({ text: text.trim() || undefined });
      setText('');
      if ('pendingBudget' in result && result.pendingBudget) {
        setEnergyReset(result.resetsAt ?? '');
        setState('idle');
        return;
      }
      setEnergyReset(undefined);
      setState('idle');
      close();
    } catch {
      setState('failed');
    }
  };

  return (
    <form id="bug-sheet" className="bug-sheet" aria-label="Report a problem" onSubmit={submit}>
      {energyReset !== undefined ? (
        <p role="status">
          Report saved. The interim edit limit is exhausted.
          {energyReset
            ? ` The limit resets ${new Date(energyReset).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`
            : ''}
        </p>
      ) : null}
      <textarea
        aria-label="What went wrong?"
        aria-invalid={state === 'failed'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setEnergyReset(undefined);
        }}
        rows={4}
        autoFocus
      />
      <div className="bug-actions">
        <button type="button" className="bug-close" aria-label="Close" onClick={close}>
          <Icon name="close" />
        </button>
        <button type="submit" className="bug-send" disabled={state === 'sending'}>
          Send
        </button>
      </div>
    </form>
  );
}
