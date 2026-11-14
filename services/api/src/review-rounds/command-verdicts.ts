import { eq, isNull } from 'drizzle-orm';
import type { AiurClient, Decision } from '@ogm/aiur-client';
import { decisionKeyFromMarker } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { answerRound } from './store.js';

function verdictOf(
  decision: Decision,
  ownerId: string,
): { verdict: 'approved' | 'needs_work' | 'kill'; notes: string | null } | null {
  const answer = decision.active_answer ?? decision.answer;
  if (!answer) return null;
  const actor = answer.actor;
  if (
    !actor ||
    typeof actor !== 'object' ||
    !('kind' in actor) ||
    actor.kind !== 'operator' ||
    !('id' in actor) ||
    actor.id !== ownerId
  )
    return null;
  let option = answer.selected_option_id ?? answer.option_id ?? answer.option;
  let response: unknown = answer.custom_response;
  if (typeof response === 'string') {
    try {
      response = JSON.parse(response) as unknown;
    } catch {
      /* plain creator note */
    }
  }
  if (!option && response && typeof response === 'object' && 'answers' in response && Array.isArray(response.answers)) {
    const selected = response.answers.filter(
      (item: unknown) =>
        item &&
        typeof item === 'object' &&
        'verdict' in item &&
        item.verdict === 'like' &&
        'option_id' in item &&
        ['approved', 'needs_work', 'kill'].includes(String(item.option_id)),
    );
    if (selected.length === 1) option = selected[0].option_id as string;
  }
  if (option !== 'approved' && option !== 'needs_work' && option !== 'kill') return null;
  const notes =
    typeof response === 'string'
      ? response
      : response && typeof response === 'object' && 'notes' in response && typeof response.notes === 'string'
        ? response.notes
        : null;
  return { verdict: option, notes };
}

// A Command opts in with `--key <round-id>` and explicit verdict option IDs. Only the game owner's answer counts.
export async function syncCommandVerdicts(
  db: Db,
  clientForGame: (gameId: string) => Promise<AiurClient>,
  now: () => string,
  log: (line: Record<string, unknown>) => void,
): Promise<void> {
  const rounds = db.select().from(schema.reviewRounds).where(isNull(schema.reviewRounds.verdict)).all();
  for (const round of rounds) {
    try {
      const game = db.select().from(schema.games).where(eq(schema.games.id, round.gameId)).get();
      if (!game?.ownerId) continue;
      const client = await clientForGame(round.gameId);
      const decisions = await client.decisions({ ticket: round.ticket, limit: 100 });
      const matching = decisions
        .filter(
          (decision) =>
            decision.ticket.identifier === round.ticket &&
            decisionKeyFromMarker(decision.context?.long_context_markdown) === round.id,
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (!matching) continue;
      const verdict = verdictOf(matching, game.ownerId);
      if (verdict) answerRound(db, round.gameId, round.id, { ...verdict, source: 'command', at: now() });
    } catch (error) {
      log({ event: 'review_command_sync_error', roundId: round.id, error: (error as Error).name });
    }
  }
}
