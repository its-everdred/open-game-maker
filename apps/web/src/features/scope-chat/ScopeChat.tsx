import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import type { BudgetStatus, ScopeChoices } from '@ogm/contracts';

import { api } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import { answerCheckpoint } from '../build-chat/checkpoints';
import { formatUnits } from '../build-chat/units';
import { AiurConversation, jobScope, type AiurCommandAnswer } from '../aiur/embed';
import { admitNewGame, type AdmissionResult, type SupportedOffer } from './admit';
import { Captions } from './Captions';
import { Composer } from './Composer';
import { energyRefusalText } from '../energy/api';
import { Offers } from './Offers';
import { useScopeSession } from './useScopeSession';

export function ScopeChat({
  gameId,
  choices,
  onSession,
}: {
  gameId: string;
  choices: ScopeChoices;
  onSession?(sessionId: string): void;
}) {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const scopeSession = useScopeSession(gameId, choices);
  const [refusal, setRefusal] = useState<Extract<AdmissionResult, { kind: 'refused' }>>();
  const [attempt, setAttempt] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [admissionError, setAdmissionError] = useState('');
  const [waitingForAdmin, setWaitingForAdmin] = useState(false);
  const budget = useQuery({
    queryKey: ['new-game', 'budget', gameId],
    queryFn: () => api<BudgetStatus>('/budget/status'),
    enabled: waitingForAdmin,
    refetchInterval: waitingForAdmin ? 30_000 : false,
  });
  const voiceTarget = useMemo(
    () =>
      scopeSession.sessionId && session?.user.id
        ? {
            kind: 'scope' as const,
            game_id: gameId,
            session_id: scopeSession.sessionId,
            creator_id: session.user.id,
          }
        : undefined,
    [gameId, scopeSession.sessionId, session?.user.id],
  );

  useEffect(() => {
    if (scopeSession.sessionId) onSession?.(scopeSession.sessionId);
  }, [onSession, scopeSession.sessionId]);

  const admit = async (start: 'now' | 'at_reset') => {
    if (!scopeSession.sessionId || !scopeSession.scope) return;
    setSubmitting(true);
    setAdmissionError('');
    try {
      const result = await admitNewGame(
        { gameId, sessionId: scopeSession.sessionId, scope: scopeSession.scope, attempt, start },
        { request: api, navigate },
      );
      if (result.kind === 'refused') setRefusal(result);
      setAttempt((current) => current + 1);
    } catch {
      setAdmissionError('The build could not be started. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const choose = (offer: SupportedOffer) => {
    if (offer === 'queue') return admit('at_reset');
    setWaitingForAdmin(true);
  };

  if (scopeSession.status === 'unavailable' || scopeSession.status === 'error') {
    return (
      <div className="talk-host">
        <section className="vs two" aria-label="Scope conversation">
          <p className="scope-error" role="alert">
            {scopeSession.error}
          </p>
          <footer className="scope-controls">
            <span className="grow" />
            <button className="scope-finish tap-primary" type="button" disabled>
              Finish
            </button>
          </footer>
        </section>
      </div>
    );
  }

  const answer = (detail: AiurCommandAnswer) => {
    void answerCheckpoint(detail.job_id, detail.checkpoint_id, detail.option_id);
  };
  const conversation = (
    <>
      <Captions turns={scopeSession.turns} status={scopeSession.status} />
      {scopeSession.jobId ? (
        <Composer
          jobId={scopeSession.jobId}
          voiceTarget={voiceTarget}
          postText={(_jobId, text, attachments) => scopeSession.send(text, attachments)}
          onOptimistic={scopeSession.addMessage}
        />
      ) : null}
    </>
  );

  return (
    <div className="talk-host">
      <section className="vs two" aria-label="Scope conversation">
        {scopeSession.jobId ? (
          // New Game creation uses the same conversation component as the job modal; aiur replaces the captions and
          // composer once its element is installed, and the admission controls stay Open Game Maker's.
          <AiurConversation scope={jobScope(gameId, scopeSession.jobId, null)} title="New game" onAnswer={answer}>
            {conversation}
          </AiurConversation>
        ) : (
          conversation
        )}
        {refusal && !waitingForAdmin ? (
          <Offers
            offers={refusal.offers}
            message={energyRefusalText(refusal.window)}
            disabled={submitting}
            onChoose={(offer) => void choose(offer)}
          />
        ) : null}
        {waitingForAdmin ? (
          <AllowanceStatus
            budget={budget.data}
            fallback={refusal}
            disabled={submitting}
            onTry={() => void admit('now')}
          />
        ) : null}
        {admissionError ? (
          <p className="scope-admission-error" role="alert">
            {admissionError}
          </p>
        ) : null}
        <footer className="scope-controls">
          <span className="grow" />
          <button
            className="scope-finish tap-primary"
            type="button"
            disabled={!scopeSession.scope || submitting || Boolean(refusal) || waitingForAdmin}
            onClick={() => void admit('now')}
          >
            {submitting ? 'Starting…' : 'Finish'}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function AllowanceStatus({
  budget,
  fallback,
  disabled,
  slot = 'new_game',
  onTry,
}: {
  budget?: BudgetStatus;
  fallback?: Extract<AdmissionResult, { kind: 'refused' }>;
  disabled: boolean;
  slot?: keyof BudgetStatus['freeSlots'];
  onTry(): void;
}) {
  const reset = budget?.resetsAt ?? fallback?.resetsAt;
  const canTry =
    budget !== undefined &&
    (budget.freeSlots[slot] > 0 ||
      budget.remainingMicroUsd > (fallback?.remainingMicroUsd ?? budget.remainingMicroUsd));
  return (
    <section className="scope-allowance" aria-label="Allowance status">
      <b>{budget ? `${formatUnits(budget.remainingMicroUsd, budget.unitLabel)} remain` : 'Checking your allowance…'}</b>
      {reset ? <span>Resets {new Date(reset).toLocaleString()}</span> : null}
      <button className="tap-secondary" disabled={disabled || !canTry} type="button" onClick={onTry}>
        Try again
      </button>
    </section>
  );
}
