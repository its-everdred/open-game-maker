import { createAiurClient } from '@ogm/aiur-client';
import { parse as parseYaml } from 'yaml';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { EXIT, CommandError, type GmCommand } from '../../command.js';
import { inventoryPath, readInventory, writeInventory } from '../../decision-inventory.js';

const AnswerMap = z
  .object({
    kind: z.literal('question_answers'),
    answers: z.array(
      z
        .object({ option_id: z.string(), verdict: z.enum(['like', 'dislike']), note: z.string().optional() })
        .passthrough(),
    ),
    notes: z.string().optional(),
  })
  .passthrough();

type RaisedDecision = {
  decision_id: string;
  question: string;
  context?: { long_context_markdown?: string | null };
  answer?: { custom_response?: string | null } | null;
  active_answer?: { custom_response?: string | null } | null;
  decision_status: string;
};

type SyncOptions = {
  inventory: ReturnType<typeof readInventory>;
  decisions: RaisedDecision[];
  now?: () => string;
};

function commandId(decision: RaisedDecision): string | null {
  const context = decision.context?.long_context_markdown ?? '';
  return /<!-- gm-command:(cp_[0-7][0-9A-HJKMNP-TV-Z]{25}) -->/u.exec(context)?.[1] ?? null;
}

function inventoryAnswer(decision: RaisedDecision, labels: Map<string, string>): string | null {
  const raw = decision.active_answer?.custom_response ?? decision.answer?.custom_response;
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = AnswerMap.safeParse(parsed);
  if (!result.success) return null;
  const liked = result.data.answers
    .filter((answer) => answer.verdict === 'like')
    .map((answer) => {
      const label = labels.get(answer.option_id);
      return label === undefined ? null : answer.note === undefined ? label : `${label}: ${answer.note}`;
    });
  if (liked.some((label) => label === null)) return null;
  const note = result.data.notes;
  const answer = liked.filter((label): label is string => label !== null).join(', ');
  if (answer && note !== undefined) return `${answer}: ${note}`;
  return answer || (note ?? null);
}

/** Applies answered review maps to a validated inventory. Exported for deterministic command tests. */
export function syncInventory({ inventory, decisions, now = () => new Date().toISOString() }: SyncOptions): number {
  let updated = 0;
  for (const decision of decisions) {
    if (decision.decision_status !== 'answered') continue;
    const id = commandId(decision);
    if (!id) continue;
    const entry = inventory.find((item) => item.status === 'asked' && item.command_id === id);
    if (!entry) continue;
    const labels = new Map(
      entry.options.map((option, index) => [
        option.label
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 32) || `option-${index + 1}`,
        option.label,
      ]),
    );
    const answer = inventoryAnswer(decision, labels);
    if (answer === null) continue;
    entry.status = 'answered';
    entry.answer = answer;
    entry.answered_at = now();
    entry.command_id = null;
    updated++;
  }
  return updated;
}

async function listAiurDecisions(ctx: Parameters<GmCommand['run']>[0]): Promise<RaisedDecision[]> {
  const home = ctx.home ?? homedir();
  let registry: unknown;
  try {
    registry = parseYaml(await readFile(join(home, '.aiur', 'remote-instances.yaml'), 'utf8'));
  } catch {
    throw new CommandError('Aiur instance registry is missing; start the game instance before syncing decisions');
  }
  const instances = z
    .object({
      instances: z.record(z.string(), z.object({ url: z.string(), token_file: z.string() }).passthrough()),
    })
    .passthrough()
    .safeParse(registry);
  if (!instances.success) throw new CommandError('Aiur instance registry is invalid');
  const decisions: RaisedDecision[] = [];
  let fetched = false;
  let unreachable = 0;
  for (const instance of Object.values(instances.data.instances)) {
    const tokenFile = instance.token_file.startsWith('~/')
      ? join(home, instance.token_file.slice(2))
      : instance.token_file;
    let token: string;
    try {
      token = (await readFile(tokenFile, 'utf8')).trim();
    } catch {
      continue;
    }
    let url: URL;
    try {
      url = new URL(instance.url);
    } catch {
      continue;
    }
    if (!token || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') continue;
    if (!Number.isInteger(Number(url.port)) || Number(url.port) < 1 || Number(url.port) > 65535) continue;
    try {
      const client = createAiurClient({
        baseUrl: instance.url,
        token,
        supervisorToken: token,
      });
      decisions.push(...(await client.decisions({ limit: 100 }, AbortSignal.timeout(15_000))));
      fetched = true;
    } catch {
      unreachable++;
    }
  }
  if (!fetched && unreachable > 0)
    throw new CommandError('could not read decisions from any configured Aiur instance; retry when it is reachable');
  return decisions;
}

export const command: GmCommand = {
  name: 'decisions sync',
  summary: 'record answered creator review cards in the inventory',
  usage: '',
  flags: {},
  async run(ctx, args) {
    if (args.length) return EXIT.usage;
    const { file } = inventoryPath(ctx.cwd);
    const inventory = readInventory(file);
    const updated = syncInventory({ inventory, decisions: await listAiurDecisions(ctx) });
    if (updated > 0) writeInventory(file, inventory);
    ctx.out(
      updated === 0
        ? 'decision inventory is up to date'
        : `synchronized ${updated} answered decision${updated === 1 ? '' : 's'}`,
    );
    return EXIT.ok;
  },
};
