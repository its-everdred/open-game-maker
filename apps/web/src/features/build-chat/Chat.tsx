import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { BudgetStatus, Job, VoiceTarget } from '@ogm/contracts';

import { queryClient } from '../../app/query';
import { api } from '../../lib/api/client';
import { admitJob, type AdmissionResult, type SupportedOffer } from '../scope-chat/admit';
import { energyRefusalText } from '../energy/api';
import { Offers } from '../scope-chat/Offers';
import { AllowanceStatus } from '../scope-chat/ScopeChat';
import { Composer } from './Composer';
import { AiurComposer } from './AiurComposer';
import type { EditDraft } from './dock';
import { editJobRequest } from './edit';
import { gameJobsQueryKey, isTerminal, myJobsQueryKey } from './jobs';
import { MessageList } from './MessageList';
import { ConversationReviews } from '../worker-builds/ConversationReviews';
import { reduceMessages, subscribeChat, type StreamedChatMessage } from './stream';
import './chat.css';

type Refusal = Extract<AdmissionResult, { kind: 'refused' }>;

export function Chat({
  jobId,
  job,
  draft,
  onBack,
  onAdmitted,
  onMessages,
  heading = true,
  useAiurComposer = false,
  composerReading = 'inline',
  dictationTarget,
  conversationVoiceTarget,
}: {
  jobId?: string;
  job?: Job;
  draft?: EditDraft;
  onBack(): void;
  onAdmitted?(jobId: string, draft: EditDraft): void;
  onMessages?(jobId: string, messages: StreamedChatMessage[]): void;
  // The dock keeps its own header; the conversation modal already names the job, so it hides this one.
  heading?: boolean;
  useAiurComposer?: boolean;
  composerReading?: 'inline' | 'stacked';
  dictationTarget?: VoiceTarget;
  conversationVoiceTarget?: VoiceTarget;
}) {
  const streamId = jobId ?? job?.id;
  const target: EditDraft = job
    ? { gameId: job.gameId, branchId: job.branchId, title: job.plan.title }
    : (draft ?? { gameId: '', branchId: 'main', title: '' });
  const canPost = streamId !== undefined && !(job && job.id === streamId && isTerminal(job.state));
  const [messages, setMessages] = useState<StreamedChatMessage[]>([]);
  const [tab, setTab] = useState<'chat' | 'reviews'>('chat');
  const [pendingText, setPendingText] = useState('');
  const [refusal, setRefusal] = useState<Refusal>();
  const [waitingForAdmin, setWaitingForAdmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [admissionError, setAdmissionError] = useState('');
  const since = useRef(0);
  const admittingRef = useRef(false);
  const admissionKeyRef = useRef<{ text: string; key: string }>(undefined);
  const admissionReused = useRef(false);
  const mountedRef = useRef(true);
  const budget = useQuery({
    queryKey: ['build-chat', 'edit-budget', target.gameId],
    queryFn: () => api<BudgetStatus>('/budget/status'),
    enabled: waitingForAdmin,
    refetchInterval: waitingForAdmin ? 30_000 : false,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (streamId === undefined) return;
    since.current = 0;
    return subscribeChat(streamId, since.current, (message, sequence) => {
      since.current = Math.max(since.current, sequence);
      setMessages((current) => reduceMessages(current, message));
    });
  }, [streamId]);

  useEffect(() => {
    if (streamId !== undefined) onMessages?.(streamId, messages);
  }, [streamId, messages, onMessages]);

  const addMessage = (message: StreamedChatMessage) => setMessages((current) => reduceMessages(current, message));
  const removeMessage = (messageId: string) => setMessages((current) => current.filter(({ id }) => id !== messageId));
  const voiceTarget = useMemo(
    () =>
      conversationVoiceTarget ??
      (job && canPost
        ? {
            kind: 'build' as const,
            game_id: job.gameId,
            job_id: job.id,
            ticket: job.aiurIssueNumber === null ? '' : String(job.aiurIssueNumber),
            creator_id: job.creatorId,
          }
        : undefined),
    [canPost, job, conversationVoiceTarget],
  );

  const admit = async (text: string, start: 'now' | 'at_reset'): Promise<string | undefined> => {
    if (admittingRef.current) throw new Error('admission in flight');
    admittingRef.current = true;
    setSubmitting(true);
    setAdmissionError('');
    // One key per instruction, so a retry after a lost response finds the job the first request created.
    if (admissionKeyRef.current?.text !== text)
      admissionKeyRef.current = {
        text,
        key:
          conversationVoiceTarget?.kind === 'edit'
            ? `voice-edit:${conversationVoiceTarget.game_id}:${conversationVoiceTarget.session_id}`
            : `edit:${crypto.randomUUID()}`,
      };
    try {
      const result = await admitJob(editJobRequest(target, text, start, admissionKeyRef.current.key));
      if (result.kind === 'refused') {
        setPendingText(text);
        setRefusal(result);
        return undefined;
      }
      admissionKeyRef.current = undefined;
      admissionReused.current = result.reused === true && result.samePlan !== true;
      setRefusal(undefined);
      setWaitingForAdmin(false);
      void queryClient.invalidateQueries({ queryKey: myJobsQueryKey });
      void queryClient.invalidateQueries({ queryKey: gameJobsQueryKey(target.gameId) });
      if (mountedRef.current) onAdmitted?.(result.jobId, target);
      return result.jobId;
    } finally {
      admittingRef.current = false;
      setSubmitting(false);
    }
  };

  const retry = async (start: 'now' | 'at_reset') => {
    try {
      await admit(pendingText, start);
    } catch {
      setAdmissionError('The build could not be started. Try again.');
    }
  };

  const choose = (offer: SupportedOffer) => {
    if (offer === 'queue') return retry('at_reset');
    setWaitingForAdmin(true);
  };

  return (
    <section className="build-chat-chat" aria-label={`${job?.plan.title ?? target.title} build chat`}>
      {heading ? (
        <header className="build-chat-chat-head">
          <button className="build-chat-back tap-secondary" type="button" onClick={onBack}>
            Back
          </button>
          <h3>{job?.plan.title ?? target.title}</h3>
        </header>
      ) : null}
      {job?.aiurIssueNumber != null && (
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
      )}
      {job?.aiurIssueNumber != null && (
        <div style={{ display: tab === 'reviews' ? 'contents' : 'none' }}>
          <ConversationReviews
            gameId={job.gameId}
            ticket={String(job.aiurIssueNumber)}
            creatorId={job.creatorId}
            jobId={job.id}
            visible={tab === 'reviews'}
          />
        </div>
      )}
      <div style={{ display: tab === 'chat' ? 'contents' : 'none' }}>
        <MessageList messages={messages} />
        {refusal && !waitingForAdmin ? (
          <Offers
            offers={refusal.offers}
            message={energyRefusalText(refusal.window, refusal.resetsAt, refusal.reason)}
            disabled={submitting}
            onChoose={(offer) => void choose(offer)}
          />
        ) : null}
        {refusal && waitingForAdmin ? (
          <AllowanceStatus
            budget={budget.data}
            fallback={refusal}
            disabled={submitting}
            slot="edit"
            onTry={() => void retry('now')}
          />
        ) : null}
        {admissionError ? (
          <p className="scope-admission-error" role="alert">
            {admissionError}
          </p>
        ) : null}
        {useAiurComposer ? (
          <AiurComposer
            reading={composerReading}
            dictationTarget={dictationTarget}
            jobId={streamId ?? `edit-${target.gameId}-${target.branchId}`}
            voiceTarget={voiceTarget}
            postText={postChatText}
            startJob={canPost ? undefined : (text) => admit(text, 'now')}
            wasAdmissionReused={() => admissionReused.current}
            onOptimistic={addMessage}
            onPosted={addMessage}
            onFailed={removeMessage}
          />
        ) : (
          <Composer
            jobId={streamId ?? `edit-${target.gameId}-${target.branchId}`}
            voiceTarget={voiceTarget}
            postText={postChatText}
            startJob={canPost ? undefined : (text) => admit(text, 'now')}
            onOptimistic={addMessage}
            onPosted={addMessage}
            onFailed={removeMessage}
          />
        )}
      </div>
    </section>
  );
}

async function postChatText(jobId: string, text: string, attachments?: string[]): Promise<StreamedChatMessage> {
  return api<StreamedChatMessage>(`/jobs/${encodeURIComponent(jobId)}/chat`, {
    method: 'POST',
    json: { ...(text ? { text } : {}), ...(attachments ? { attachments } : {}) },
  });
}
