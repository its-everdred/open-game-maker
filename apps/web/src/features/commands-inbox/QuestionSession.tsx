import { useMemo, useState } from 'react';

import type { QuestionSession as QueuedSession } from '@ogm/contracts';

import { queryClient } from '../../app/query';
import { Dialog } from '../../components/Dialog';
import { creatorCommandsQueryKey } from './commands';
import { DecisionVoice, type DecisionVoiceTarget } from './decision-voice';
import '../build-chat/conversation-modal.css';
import './question-session.css';

// A quick question session (#612): opening the inbox entry starts a two-way voice chat that asks the game's queued
// product questions one at a time. The agent saves each clear answer to its Command as it is heard; the creator can say
// "skip" or "stop", or end the call here. Whatever is left unanswered stays queued.
export function QuestionSession({
  session,
  creatorId,
  onClose,
  voice = DecisionVoice,
}: {
  session: QueuedSession;
  creatorId: string;
  onClose(): void;
  voice?: typeof DecisionVoice;
}) {
  const Voice = voice;
  const [live, setLive] = useState(false);
  const target = useMemo<DecisionVoiceTarget>(
    () => ({ kind: 'questions', game_id: session.game_id, creator_id: creatorId }),
    [creatorId, session.game_id],
  );
  return (
    <Dialog
      title={session.game_title}
      className="job-conversation-dialog question-session"
      backdropClassName="job-conversation-backdrop"
      onClose={onClose}
    >
      <button type="button" className="job-conversation-close" aria-label="Close" onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
      <div className="question-session-body" data-live={live}>
        <Voice
          target={target}
          autoStart
          onLive={setLive}
          onSpeaking={() => undefined}
          onHeard={() => void queryClient.invalidateQueries({ queryKey: creatorCommandsQueryKey })}
        />
        <span className="question-session-count" aria-label={`${session.count} questions`}>
          {session.count}
        </span>
      </div>
    </Dialog>
  );
}
