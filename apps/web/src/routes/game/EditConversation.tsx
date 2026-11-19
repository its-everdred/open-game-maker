import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job, VoiceTarget } from '@ogm/contracts';
import { Chat } from '../../features/build-chat/Chat';
import { useSession } from '../../lib/api/session';

export function EditConversation({
  gameId,
  branchId,
  title,
  job,
  admittedJobId,
  completedJobId,
  onAdmitted,
  reading,
}: {
  gameId: string;
  branchId: string;
  title: string;
  job?: Job;
  admittedJobId?: string;
  completedJobId?: string;
  onAdmitted(id: string): void;
  reading: 'inline' | 'stacked';
}) {
  const { data: session } = useSession();
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const lastCompleted = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (completedJobId && lastCompleted.current !== completedJobId) {
      lastCompleted.current = completedJobId;
      setSessionId(crypto.randomUUID());
    }
  }, [completedJobId]);
  // Dictation only transcribes; the game-scoped token authorizes the microphone before a job exists.
  const dictationTarget = useMemo<VoiceTarget | undefined>(
    () =>
      session?.user?.id && gameId
        ? {
            kind: 'edit',
            game_id: gameId,
            creator_id: session.user.id,
            session_id: sessionId,
            ...(job?.id || admittedJobId ? { job_id: job?.id ?? admittedJobId } : {}),
          }
        : undefined,
    [session?.user?.id, gameId, sessionId, job?.id, admittedJobId],
  );
  return (
    <Chat
      key={`${gameId}:${branchId}`}
      draft={{ gameId, branchId, title }}
      job={job}
      heading={false}
      onBack={() => {}}
      onAdmitted={onAdmitted}
      useAiurComposer
      composerReading={reading}
      dictationTarget={dictationTarget}
      conversationVoiceTarget={dictationTarget}
    />
  );
}
