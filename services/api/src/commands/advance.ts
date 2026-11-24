import type { AiurClient } from '@ogm/aiur-client';
import { fidelityEffort, nextRung, rungOfLabels, type CommandAdvance, type FidelityPhase } from '@ogm/contracts';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';

type Repo = { owner: string; name: string };

// The rung each review card shows comes from the ticket's labels when the inbox is listed. A tracker that cannot be
// read leaves the strip off rather than failing the inbox.
export async function withPhases<T extends { ticket: string | null }>(
  deps: AppDeps,
  repo: Repo | undefined,
  commands: T[],
): Promise<(T & { phase?: FidelityPhase })[]> {
  if (!repo || !deps.registry.trackerTickets || !commands.some((command) => command.ticket)) return commands;
  const snapshot = await deps.registry.trackerTickets(repo, 'open').catch(() => null);
  if (!snapshot) return commands;
  const labels = new Map(snapshot.tickets.map((ticket) => [ticket.ticket, ticket.labels]));
  return commands.map((command) => {
    const phase = command.ticket ? rungOfLabels(labels.get(command.ticket) ?? []) : undefined;
    return phase ? { ...command, phase } : command;
  });
}

// The server reads the rung itself: an advance from a card shown before the ticket moved is refused, never applied
// to the wrong rung.
export async function currentRung(
  deps: AppDeps,
  repo: Repo | undefined,
  ticket: string,
  advance: CommandAdvance,
): Promise<FidelityPhase> {
  if (!repo || !deps.registry.trackerTicket || !deps.registry.fidelityWriter)
    throw new HttpError(503, 'advance_unavailable');
  const issue = await deps.registry.trackerTicket(repo, ticket).catch(() => {
    throw new HttpError(503, 'advance_unavailable');
  });
  const phase = rungOfLabels(issue?.labels ?? []);
  if (!phase || nextRung(phase) !== advance) throw new HttpError(409, 'advance_stale');
  return phase;
}

// What the ticket moves to and what the worker is told, from the gm-prototype rung table.
const STEPS: Record<FidelityPhase, { to?: FidelityPhase; reason: string }> = {
  mock: {
    to: 'prototype',
    reason:
      'The creator approved the mock round; you are now at phase:prototype (effort medium): build the approved mock in the engine as three in-context variations (A/B/C), recreating its style with the real assets.',
  },
  prototype: {
    to: 'build',
    reason:
      'The creator approved the prototype round; you are now at phase:build (effort xhigh): build the approved prototype in the game itself at every screen size, recreating its style with the real assets.',
  },
  build: {
    to: 'polish',
    reason: 'The creator approved the build round; you are now at phase:polish (effort high): ship the approved build.',
  },
  polish: { reason: 'The creator approved the polish round, the last rung: ship it and close the ticket.' },
};

export function advanceReason(phase: FidelityPhase): string {
  return STEPS[phase].reason;
}

// Runs after the answer reached the worker. The labels change before the rework, so the worker's next turn reads the
// new rung. Both steps are idempotent, so a retried delivery never moves the ticket twice. Returns false when either
// step failed, after logging it: the answer itself is already saved.
export async function deliverAdvance(
  deps: AppDeps,
  input: { client: Pick<AiurClient, 'rework'>; repo: Repo; ticket: string; phase: FidelityPhase; key: string },
): Promise<boolean> {
  const { to, reason } = STEPS[input.phase];
  try {
    if (to)
      await deps.registry.fidelityWriter!.setFidelity(
        `${input.repo.owner}/${input.repo.name}`,
        input.ticket,
        to,
        fidelityEffort[to],
      );
    await input.client.rework(input.ticket, reason, `advance:${input.key}`);
    return true;
  } catch (error) {
    deps.log({
      event: 'command_advance_failed',
      ticket: input.ticket,
      phase: input.phase,
      error: (error as Error).name,
    });
    return false;
  }
}
