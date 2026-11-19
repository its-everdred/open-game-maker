import { useMemo, useState } from 'react';
import type { Job, VoiceTarget } from '@ogm/contracts';
import { Chat } from '../../features/build-chat/Chat';
import { useSession } from '../../lib/api/session';

export function EditConversation({
  gameId,
  branchId,
  title,
  job,
  onAdmitted,
  reading,
}: {
  gameId: string;
  branchId: string;
  title: string;
  job?: Job;
  onAdmitted(id: string): void;
  reading: 'inline' | 'stacked';
}) {
  const { data: session } = useSession();
  const [sessionId] = useState(() => crypto.randomUUID());
  // Dictation only transcribes; the game-scoped token authorizes the microphone before a job exists.
  const dictationTarget = useMemo<VoiceTarget | undefined>(
    () =>
      session?.user?.id && gameId
        ? {
            kind: 'edit',
            game_id: gameId,
            creator_id: session.user.id,
            session_id: sessionId,
            ...(job ? { job_id: job.id } : {}),
          }
        : undefined,
    [session?.user?.id, gameId, sessionId, job?.id],
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
