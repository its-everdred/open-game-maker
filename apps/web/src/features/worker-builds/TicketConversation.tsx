import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { api } from '../../lib/api/client';
import { ConversationReviews } from './ConversationReviews';
import '../build-chat/conversation-modal.css';
import '../build-chat/chat.css';

export type ConversationTarget = { gameId: string; ticket: string; title: string };

export function TicketConversation({
  ticket,
  creatorId,
  onClose,
}: {
  ticket: ConversationTarget;
  creatorId?: string;
  onClose(): void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [tab, setTab] = useState<'chat' | 'reviews'>('chat');
  const queryClient = useQueryClient();
  const pending = useRef<{ text: string; id: string } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const path = `/games/${encodeURIComponent(ticket.gameId)}/tickets/${encodeURIComponent(ticket.ticket)}/conversation`;
  const conversation = useQuery({
    queryKey: ['ticket-conversation', creatorId, ticket.gameId, ticket.ticket],
    queryFn: () =>
      api<{ messages: { text: string; pending?: boolean; id?: string }[]; workerUnavailable: boolean }>(path),
    retry: false,
    refetchInterval: 15000,
  });
  useEffect(() => {
    if (messagesRef.current && pinned.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [conversation.data, tab]);
  async function send(retry?: { text: string; id: string }) {
    if (sending || (!retry && !text.trim())) return;
    const message = retry ?? (pending.current?.text === text ? pending.current : { text, id: crypto.randomUUID() });
    if (!retry) pending.current = message;
    setSending(true);
    setSendError(false);
    try {
      await queryClient.cancelQueries({ queryKey: ['ticket-conversation', creatorId, ticket.gameId, ticket.ticket] });
      await api(path, { method: 'POST', json: message });
      if (!retry || pending.current?.id === retry.id) {
        pending.current = null;
        if (!retry || text === retry.text) setText('');
      }
      await conversation.refetch();
    } catch {
      setSendError(true);
      await conversation.refetch();
    } finally {
      setSending(false);
    }
  }
  return (
    <Dialog
      title={ticket.title}
      className="job-conversation-dialog ticket-conversation-dialog"
      backdropClassName="job-conversation-backdrop"
      onClose={onClose}
    >
      <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <div className="conversation-tabs" role="tablist" aria-label="Conversation">
        <button
          className="tap-secondary"
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
        <button
          className="tap-secondary"
          type="button"
          role="tab"
          aria-selected={tab === 'reviews'}
          onClick={() => setTab('reviews')}
        >
          Reviews
        </button>
      </div>
      <div
        className="build-chat-messages"
        ref={messagesRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 32;
        }}
      >
        {tab === 'chat' &&
          conversation.data?.messages.map((message, index) => (
            <p key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {message.text}
              {message.pending && (
                <>
                  {' '}
                  (delivery unconfirmed){' '}
                  {message.id && (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void send({ text: message.text, id: message.id! })}
                    >
                      Retry
                    </button>
                  )}
                </>
              )}
            </p>
          ))}
        {tab === 'chat' && conversation.isLoading && <p>Loading conversation…</p>}
        {tab === 'chat' && conversation.isError && <p role="alert">Could not load this conversation.</p>}
        {tab === 'chat' && conversation.data?.workerUnavailable && <p role="alert">Worker updates are unavailable.</p>}
        {tab === 'chat' && conversation.data?.messages.length === 0 && <p>No messages yet.</p>}
        <ConversationReviews
          gameId={ticket.gameId}
          ticket={ticket.ticket}
          creatorId={creatorId}
          inline
          showEmpty={tab === 'reviews'}
        />
      </div>
      {tab === 'chat' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor="ticket-message">Message the builder</label>
          <textarea
            id="ticket-message"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !text.trim()}>
            Send
          </button>
          {sendError && <p role="alert">Message delivery could not be confirmed. Try again.</p>}
        </form>
      )}
    </Dialog>
  );
}
