import { useMemo } from 'react';
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
  // Dictation only transcribes; the game-scoped token authorizes the microphone before a job exists.
  const dictationTarget = useMemo<VoiceTarget | undefined>(
    () =>
      session?.user?.id && gameId ? { kind: 'questions', game_id: gameId, creator_id: session.user.id } : undefined,
    [session?.user?.id, gameId],
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
    />
  );
}
