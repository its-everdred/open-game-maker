import { useEffect, useState } from 'react';

import { api } from '../../../lib/api/client';
import { CommandCard, type CommandBudget } from '../command-card';
import { answerJobCommand } from '../commands';
import type { StreamedChatMessage } from '../stream';

export function CommandRow({ message, messages }: { message: StreamedChatMessage; messages: StreamedChatMessage[] }) {
  const command = message.command;
  const [budget, setBudget] = useState<CommandBudget>();
  const [answering, setAnswering] = useState(false);

  useEffect(() => {
    let active = true;
    void api<CommandBudget>(`/jobs/${encodeURIComponent(message.job_id)}/commands/budget`)
      .then((next) => {
        if (active) setBudget(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [message.job_id, messages.length, command?.status]);

  if (!command) return message.text ? <p className="build-chat-row command">{message.text}</p> : null;

  const answer = async (optionId: string) => {
    setAnswering(true);
    try {
      await answerJobCommand(message.job_id, message.id, optionId);
    } catch {
      setAnswering(false);
    }
  };

  return (
    <CommandCard
      message={message}
      mediaById={(id) => messages.find((candidate) => candidate.id === id)}
      budget={budget}
      busy={answering}
      onAnswer={(optionId) => void answer(optionId)}
    />
  );
}
