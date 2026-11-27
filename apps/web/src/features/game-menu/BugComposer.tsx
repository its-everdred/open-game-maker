import { useRef, useState, type FormEvent, type Ref } from 'react';

import { Icon } from '../../components/Icon';
import { openConversation } from '../build-chat/conversation';
import './game-menu.css';

/** `attempt` names one bug: a retry sends the same one, so it never files twice. */
export type FileBug = (text: string, log: string, attempt: string) => Promise<{ jobId?: string }>;

type Sent = { text: string; jobId?: string };

/**
 * File a bug from the play menu (#1326): the host's log rides along, the creator describes the issue, and after it is
 * sent they can keep talking to the agent that took it or close.
 */
export function BugComposer({
  backRef,
  log,
  fileBug,
  onBack,
}: {
  backRef?: Ref<HTMLButtonElement>;
  log: string;
  fileBug: FileBug;
  onBack(): void;
}) {
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'compose' | 'sending' | 'failed' | 'sent'>('compose');
  const [sent, setSent] = useState<Sent>();
  const attempt = useRef<string>('');
  const [bugId] = useState(() => crypto.randomUUID());

  const send = async (text: string) => {
    attempt.current = text;
    setSent({ text });
    setState('sending');
    try {
      const result = await fileBug(text, log, bugId);
      if (attempt.current !== text) return;
      setSent({ text, jobId: result.jobId });
      setState('sent');
      setDraft('');
    } catch {
      if (attempt.current === text) setState('failed');
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text && state === 'compose') void send(text);
  };
  const kb = Math.max(1, Math.round(new Blob([log]).size / 1024));

  return (
    <>
      <div className="game-menu-head is-back">
        <button ref={backRef} type="button" className="game-menu-circle" aria-label="Back" onClick={onBack}>
          <Icon name="caretLeft" />
        </button>
        <h2>File a bug</h2>
      </div>
      <div className="game-menu-thread" aria-live="polite">
        {sent ? (
          <div className="game-menu-msg is-me" data-failed={state === 'failed' || undefined}>
            {sent.text}
            <span className="game-menu-chip is-small">
              <Icon name="paperclip" />
              game.log
            </span>
          </div>
        ) : null}
        {state === 'failed' && sent ? (
          <div className="game-menu-stat">
            Not sent
            <button type="button" className="game-menu-retry" onClick={() => void send(sent.text)}>
              Retry
            </button>
          </div>
        ) : null}
        {state === 'sending' ? (
          <div className="game-menu-typing" role="status" aria-label="Sending">
            <i />
            <i />
            <i />
          </div>
        ) : null}
      </div>
      {state === 'sent' ? (
        <div className="game-menu-choice">
          {sent?.jobId ? (
            <button
              type="button"
              className="game-menu-big"
              onClick={() => {
                openConversation(sent.jobId!);
                onBack();
              }}
            >
              Keep talking to the agent
            </button>
          ) : null}
          <button type="button" className="game-menu-big is-go" onClick={onBack}>
            Close
          </button>
        </div>
      ) : null}
      {state === 'compose' ? (
        <>
          <div className="game-menu-chips">
            <span className="game-menu-chip">
              <Icon name="paperclip" />
              <span>
                game.log<small>{kb} KB</small>
              </span>
            </span>
          </div>
          <form className="game-menu-comp" onSubmit={submit}>
            <input
              type="text"
              placeholder="Describe the issue"
              aria-label="Describe the issue"
              value={draft}
              maxLength={2000}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" className="game-menu-circle is-go" aria-label="Send" disabled={!draft.trim()}>
              <Icon name="send" />
            </button>
          </form>
        </>
      ) : null}
    </>
  );
}
