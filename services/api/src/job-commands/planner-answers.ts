import { createHash } from 'node:crypto';

import { schema, type Db, type Sqlite } from '@ogm/db';
import { and, eq, sql } from 'drizzle-orm';

import type { AiurClientResolver, ChatJob } from '../app/registry.js';
import { listCommands, parseCommand } from '../build-chat/store.js';
import { scopeChatJobForRequest } from '../new-game/context.js';

type Answer = {
  source: string;
  row: string;
  question: string;
  answer: string;
  revision: string;
  origin: 'player' | 'skip' | 'default' | 'unknown';
};

// The durable chat rows are authoritative even if the derived design history could not be written.
export function plannerAnswers(db: Db, sqlite: Sqlite, target: Pick<ChatJob, 'jobId' | 'gameId'>): Answer[] {
  const current = db.select().from(schema.jobs).where(eq(schema.jobs.id, target.jobId)).get();
  if (!current) return [];
  const parentId =
    /^planner:(j_[A-Za-z0-9-]+):/.exec(current.idempotencyKey ?? '')?.[1] ??
    (current.kind === 'new_game' ? current.id : null);
  if (!parentId) return [];
  const parent = db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, parentId), eq(schema.jobs.gameId, target.gameId)))
    .get();
  if (!parent || parent.kind !== 'new_game') return [];
  const children = db
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.gameId, target.gameId),
        sql`substr(${schema.jobs.idempotencyKey}, 1, ${`planner:${parentId}:`.length}) = ${`planner:${parentId}:`}`,
      ),
    )
    .all();
  const answers: Answer[] = [];
  const scopeJobId = scopeChatJobForRequest(db, parent);
  const sources = new Set([parent.id, ...children.map((child) => child.id), ...(scopeJobId ? [scopeJobId] : [])]);
  for (const source of sources) {
    for (const row of listCommands(sqlite, source)) {
      const command = parseCommand(row);
      if (!command || command.status !== 'answered') continue;
      // Aiur already knows the initial answer on this ticket, but not a later correction.
      if (source === target.jobId && command.corrected_option_id === undefined) continue;
      const selected = command.corrected_option_id ?? command.option_id;
      const answer = command.options.find((option) => option.id === selected)?.label;
      if (!answer) continue;
      answers.push({
        source,
        row: row.id,
        question: command.question,
        answer,
        origin: command.answer_origin ?? 'unknown',
        revision: `${command.version ?? 1}:${command.corrections ?? 0}:${selected}:${command.answer_origin ?? 'unknown'}`,
      });
    }
  }
  return answers;
}

export function createPlannerAnswerSync(db: Db, sqlite: Sqlite) {
  const delivered = new Set<string>();
  return async (target: ChatJob, clientFor: AiurClientResolver): Promise<void> => {
    if (!target.aiur) return;
    const answers = plannerAnswers(db, sqlite, target);
    if (!answers.length) return;
    const client = await clientFor(target.aiur.daemonSlug);
    if (!client) throw new Error('planner answer client unavailable');
    for (const answer of answers) {
      const id = createHash('sha256')
        .update(`${target.jobId}\0${answer.source}\0${answer.row}\0${answer.revision}`)
        .digest('hex');
      if (delivered.has(id)) continue;
      const result = await client.message(
        target.aiur.ticket,
        `Current decision from this game's planning work (a default is provisional): ${JSON.stringify({ question: answer.question, answer: answer.answer, origin: answer.origin })}.`,
        `ogm:planner-answer:${id}`,
        AbortSignal.timeout(10_000),
      );
      if (result.warning !== 'outcome_unknown') delivered.add(id);
      if (delivered.size > 10_000) delivered.delete(delivered.values().next().value!);
    }
  };
}
