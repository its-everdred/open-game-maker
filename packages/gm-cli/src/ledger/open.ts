import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AgentOutboxLine, CommandRequestPayload, type OptionProvenance } from '@ogm/contracts';

/** One option an agent has already presented, with the Command it was shown under. */
export type OpenOption = {
  command_id: string;
  job_id: string;
  id: string;
  label: string;
  provenance?: OptionProvenance;
};

function answeredIds(root: string): Set<string> {
  // `gm command wait` reads `.gm/inbox/commands/<id>.json`; an answered or moot Command is no longer open.
  const answered = new Set<string>();
  try {
    for (const entry of readdirSync(join(root, '.gm', 'inbox', 'commands'))) {
      if (!entry.endsWith('.json')) continue;
      answered.add(entry.slice(0, -'.json'.length));
    }
  } catch {
    // A game with no inbox has no answered Command.
  }
  return answered;
}

/** Every option still open in the job's outbox: a `command.request` line with no answer in the inbox. */
export function readOpenOptions(root: string, jobId?: string): OpenOption[] {
  const file = join(root, '.gm', 'outbox', 'command.jsonl');
  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const answered = answeredIds(root);
  const open: OpenOption[] = [];
  for (const raw of contents.split('\n')) {
    if (!raw.trim()) continue;
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const parsed = AgentOutboxLine.safeParse(line);
    if (!parsed.success || parsed.data.type !== 'command.request') continue;
    if (jobId !== undefined && parsed.data.job_id !== jobId) continue;
    const payload = CommandRequestPayload.safeParse(parsed.data.payload);
    if (!payload.success) continue;
    if (answered.has(payload.data.command_id)) continue;
    for (const option of payload.data.options) {
      open.push({
        command_id: payload.data.command_id,
        job_id: parsed.data.job_id,
        id: option.id,
        label: option.label,
        ...(option.provenance === undefined ? {} : { provenance: option.provenance }),
      });
    }
  }
  return open;
}
