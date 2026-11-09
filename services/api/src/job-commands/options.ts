import { ChatCommand, type ChatCommand as ChatCommandValue } from '@ogm/contracts';

export type CommandOption = ChatCommandValue['options'][number];

export function parseCommandOptions(raw: string): CommandOption[] | null {
  try {
    const parsed = ChatCommand.shape.options.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
