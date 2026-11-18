import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api/client';
import '../build-chat/conversation-modal.css';

// One ticket of a game, running or closed, as the API's ticket detail describes it (#873, aiur-team/aiur#8043).
export type TicketDetailView = {
  ticket: string;
  title: string;
  status: string;
  phase: string | null;
  running: boolean;
  activity: string | null;
  summary: string | null;
  issueUrl: string | null;
  pr: { number: number; url: string; state: string; ci: string | null } | null;
  media: { id: string; kind: 'image' | 'video' | 'audio'; url: string; caption: string | null }[];
  mediaPending: number;
  timeline: { at: string; kind: string; label: string | null; quote: string | null }[];
};

const STATUS: Record<string, string> = {
  queued: 'Queued',
  working: 'Working',
  ci_wait: 'Waiting for checks',
  waiting_on_creator: 'Needs review',
  human_review: 'In review',
  rework: 'Reworking',
  blocked: 'Blocked',
  error: 'Stopped',
  done: 'Done',
};
const CI: Record<string, string> = { passed: 'Checks passed', failed: 'Checks failed', pending: 'Checks running' };
const EVENT: Record<string, string> = {
  round_started: 'Round started',
  pr_opened: 'Build opened',
  ci: 'Checks',
  handoff: 'Ready for review',
  creator_verdict: 'Your verdict',
  rework: 'Rework',
  pr_merged: 'Merged',
  claim_released: 'Paused',
  error: 'Stopped',
  closed: 'Closed',
};

const words = (value: string) => value.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());
const when = (at: string) =>
  new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function TicketDetail({
  gameId,
  ticket,
  title,
  creatorId,
  onConversation,
  onClose,
}: {
  gameId: string;
  ticket: string;
  title: string;
  creatorId?: string;
  onConversation?(): void;
  onClose(): void;
}) {
  const detail = useQuery({
    queryKey: ['ticket-detail', creatorId, gameId, ticket],
    queryFn: () =>
      api<TicketDetailView>(`/games/${encodeURIComponent(gameId)}/tickets/${encodeURIComponent(ticket)}/detail`),
    // A running ticket keeps producing stills and rounds, and media still copying arrives on a later read; a closed
    // ticket with all its media in place does not change.
    refetchInterval: (query) => (query.state.data?.running || query.state.data?.mediaPending ? 5_000 : false),
    retry: false,
  });
  const data = detail.data;
  return (
    <Dialog
      title={data?.title ?? title}
      className="job-conversation-dialog ticket-detail-dialog"
      backdropClassName="job-conversation-backdrop"
      onClose={onClose}
    >
      <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <div className="ticket-detail-body">
        {detail.isLoading && <p>Loading…</p>}
        {detail.isError && <p role="alert">Could not load this ticket.</p>}
        {data && (
          <>
            <p className="ticket-detail-chips">
              <span>{STATUS[data.status] ?? words(data.status)}</span>
              {data.phase && <span>{words(data.phase)}</span>}
              {data.pr && (
                <a href={data.pr.url} target="_blank" rel="noreferrer">
                  #{data.pr.number} {words(data.pr.state)}
                </a>
              )}
              {data.pr?.ci && <span>{CI[data.pr.ci] ?? words(data.pr.ci)}</span>}
              {data.issueUrl && (
                <a href={data.issueUrl} target="_blank" rel="noreferrer" aria-label="Ticket">
                  <Icon name="link" />
                </a>
              )}
              <Link to={`/g/${encodeURIComponent(gameId)}`} aria-label="Open game">
                <Icon name="play" />
              </Link>
              {onConversation && (
                <button type="button" aria-label="Conversation" onClick={onConversation}>
                  <Icon name="decisions" />
                </button>
              )}
            </p>
            {data.summary && <p className="ticket-detail-summary">{data.summary}</p>}
            {data.running && data.activity && <p className="ticket-detail-activity">{data.activity}</p>}
            {data.media.length > 0 && (
              <ul className="ticket-detail-media">
                {data.media.map((item) => (
                  <li key={item.id} className={`ticket-detail-${item.kind}`}>
                    <figure>
                      {item.kind === 'image' && <img src={item.url} alt={item.caption ?? ''} loading="lazy" />}
                      {item.kind === 'video' && (
                        <video
                          src={item.url}
                          controls
                          playsInline
                          muted
                          preload="metadata"
                          aria-label={item.caption ?? undefined}
                        />
                      )}
                      {item.kind === 'audio' && (
                        <audio src={item.url} controls preload="metadata" aria-label={item.caption ?? undefined} />
                      )}
                      {item.caption && <figcaption>{item.caption}</figcaption>}
                    </figure>
                  </li>
                ))}
              </ul>
            )}
            {data.timeline.length > 0 && (
              <ol className="ticket-detail-timeline">
                {[...data.timeline].reverse().map((entry, index) => (
                  <li key={`${entry.at}:${index}`}>
                    <time dateTime={entry.at}>{when(entry.at)}</time>
                    <span>{entry.label ?? EVENT[entry.kind] ?? words(entry.kind)}</span>
                    {entry.quote && <blockquote>{entry.quote}</blockquote>}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
