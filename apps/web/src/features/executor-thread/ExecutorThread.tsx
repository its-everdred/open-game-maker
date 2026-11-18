import { useEffect, useRef } from 'react';

import type { ChatAttachment, CreatorCommand } from '@ogm/contracts/browser';

import { Dialog } from '../../components/Dialog';
import { Composer } from '../build-chat/Composer';
import {
  closeThread,
  sendThreadMessage,
  shownText,
  threadMessages,
  uploadThreadFile,
  useThreadStore,
  type ThreadAttachment,
  type ThreadContext,
  type ThreadMedia,
  type ThreadMessage,
} from './thread';
import '../build-chat/chat.css';
import '../build-chat/command-card.css';
import '../build-chat/conversation-modal.css';
import './executor-thread.css';

// Ask and Answer: the creator's thread with the Executor, over whatever screen they are on. Sends carry where
// they were; replies show their pictures, clips and sounds inline; open review Commands sit in the thread and open the
// review deck.
export function ExecutorThread({
  creatorId,
  title,
  context,
  commands,
  onOpenCommand,
}: {
  creatorId: string;
  title: string;
  context: ThreadContext;
  commands: readonly CreatorCommand[];
  onOpenCommand(command: CreatorCommand): void;
}) {
  const open = useThreadStore((state) => state.open);
  const journal = useThreadStore((state) => state.journal);
  const queued = useThreadStore((state) => state.queued);
  const local = useThreadStore((state) => state.local);
  const listRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // What each upload was, by the id the composer hands back; pasted text never uploads and goes into the message.
  const uploads = useRef(new Map<string, ThreadAttachment | { text: string; name: string }>());
  const retry = useRef<{ key: string; id: string }>(undefined);
  const messages = threadMessages({ journal, queued, local });

  useEffect(() => {
    const list = listRef.current;
    if (list && pinned.current) list.scrollTop = list.scrollHeight;
  }, [messages.length, commands.length, open]);

  if (!open) return null;

  const upload = async (_thread: string, file: File, type: string): Promise<ChatAttachment> => {
    const id = `u${uploads.current.size + 1}-${crypto.randomUUID()}`;
    if (type.startsWith('image/')) {
      const { upload_id } = await uploadThreadFile(file, type);
      uploads.current.set(id, { upload_id, kind: 'image', mime_type: type });
    } else {
      uploads.current.set(id, { text: await file.text(), name: file.name });
    }
    // The composer reads only the id back.
    return { id, kind: 'image', name: file.name, mime: 'image/webp', bytes: Math.max(1, file.size) } as ChatAttachment;
  };

  const post = async (_thread: string, text: string, ids: string[] = []) => {
    const attachments: ThreadAttachment[] = [];
    const pasted: string[] = [];
    for (const id of ids) {
      const item = uploads.current.get(id);
      if (!item) continue;
      if ('upload_id' in item) attachments.push(item);
      else pasted.push(`${item.name}:\n${item.text}`);
    }
    const body = fit([text, ...pasted].filter(Boolean).join('\n\n')) || 'See attached.';
    // A retry of the same message keeps its id, so a send whose reply was lost is not delivered twice.
    const key = JSON.stringify([body, attachments]);
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    await sendThreadMessage(creatorId, body, context, attachments, retry.current.id);
    retry.current = undefined;
  };

  return (
    <Dialog
      title={title}
      className="job-conversation-dialog executor-thread"
      backdropClassName="job-conversation-backdrop"
      onClose={closeThread}
    >
      <button type="button" className="job-conversation-close" aria-label="Close" onClick={closeThread}>
        <span aria-hidden="true">×</span>
      </button>
      <section className="build-chat-chat" aria-label="Executor">
        <div
          ref={listRef}
          className="build-chat-messages"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          onScroll={(event) => {
            const list = event.currentTarget;
            pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight <= 32;
          }}
        >
          {messages.map((message) => (
            <ThreadRow key={message.id} message={message} />
          ))}
          {commands.map((command) => (
            <CommandCard key={command.decision_id} command={command} onOpen={() => onOpenCommand(command)} />
          ))}
        </div>
        <Composer jobId="executor-thread" postText={post} uploadAttachment={upload} />
      </section>
    </Dialog>
  );
}

// The API takes up to MAX_THREAD_TEXT characters; a long paste is cut rather than failing the whole message.
const MAX_THREAD_TEXT = 15_000;
function fit(text: string): string {
  return text.length <= MAX_THREAD_TEXT ? text : `${text.slice(0, MAX_THREAD_TEXT - 1)}…`;
}

function ThreadRow({ message }: { message: ThreadMessage }) {
  const text = shownText(message);
  const actor = message.role === 'operator' ? 'creator' : message.role === 'executor' ? 'agent' : 'system';
  const pictures = message.attachments.filter((media) => media.kind !== 'audio');
  const sounds = message.attachments.filter((media) => media.kind === 'audio');
  const waiting = message.local === 'sending' || message.delivery === 'queued';
  return (
    <>
      {text ? (
        <article className={`build-chat-row text ${actor}`} data-waiting={waiting || undefined}>
          <p>{text}</p>
        </article>
      ) : null}
      {pictures.length > 0 ? (
        <div
          className={`build-chat-row media executor-thread-media ${actor}`}
          data-count={Math.min(pictures.length, 2)}
        >
          {pictures.map((media) => (
            <Picture key={media.id} media={media} />
          ))}
        </div>
      ) : null}
      {sounds.map((media) => (
        <audio
          key={media.id}
          className={`executor-thread-audio ${actor}`}
          controls
          preload="metadata"
          src={media.url}
        />
      ))}
    </>
  );
}

function Picture({ media }: { media: ThreadMedia }) {
  return (
    <figure className="build-chat-media-frame">
      {media.kind === 'video' ? (
        <video controls muted loop playsInline preload="metadata" src={media.url} />
      ) : (
        <a href={media.url} target="_blank" rel="noreferrer">
          <img alt="" src={media.url} />
        </a>
      )}
    </figure>
  );
}

function CommandCard({ command, onOpen }: { command: CreatorCommand; onOpen(): void }) {
  const titleId = `executor-thread-command-${command.decision_id}`;
  return (
    <article className="build-chat-row command command-open" aria-labelledby={titleId}>
      <strong id={titleId}>{command.summary ?? command.title}</strong>
      <div className="build-chat-options">
        {command.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="build-chat-option"
            aria-label={option.label}
            onClick={onOpen}
          >
            {option.media && option.media.kind !== 'audio' ? (
              <span className="command-option-media">
                {option.media.kind === 'video' ? (
                  <video muted playsInline preload="metadata" poster={option.media.poster} src={option.media.url} />
                ) : (
                  <img alt="" src={option.media.url} />
                )}
              </span>
            ) : null}
            <span className="command-option-label">{option.label}</span>
          </button>
        ))}
      </div>
    </article>
  );
}
