import type { StreamedChatMessage } from '../stream';

export function TextRow({ message }: { message: StreamedChatMessage }) {
  const attachments = message.attachments ?? [];
  if (!message.text && attachments.length === 0) return null;
  return (
    <article className={`build-chat-row text ${message.actor}`} data-optimistic={message.optimistic || undefined}>
      {message.text ? <p>{message.text}</p> : null}
      {attachments.length > 0 ? (
        <ul className="build-chat-attachments">
          {attachments.map(({ id, name }) => (
            <li key={id}>
              <span>{name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
