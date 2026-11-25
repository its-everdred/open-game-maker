import { useQuery } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog';
import { api } from '../../lib/api/client';
import '../build-chat/conversation-modal.css';

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
  const conversation = useQuery({
    queryKey: ['ticket-conversation', creatorId, ticket.gameId, ticket.ticket],
    queryFn: () =>
      api<{ messages: { text: string }[] }>(
        `/games/${encodeURIComponent(ticket.gameId)}/tickets/${encodeURIComponent(ticket.ticket)}/conversation`,
      ),
    retry: false,
  });
  return (
    <Dialog
      title={ticket.title}
      className="job-conversation-dialog"
      backdropClassName="job-conversation-backdrop"
      onClose={onClose}
    >
      <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <div className="build-chat-messages">
        {conversation.data?.messages.map((message, index) => (
          <p key={index}>{message.text}</p>
        ))}
        {conversation.isLoading && <p>Loading conversation…</p>}
        {conversation.isError && <p role="alert">Could not load this conversation.</p>}
        {conversation.data?.messages.length === 0 && <p>No creator-visible messages.</p>}
      </div>
    </Dialog>
  );
}
