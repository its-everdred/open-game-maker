import type { DesignDecision } from '@ogm/contracts';

import type { FeedbackLedger } from '../ledger/index.js';

/**
 * The premise sweep (`skills/gm-new-game-plan/references/answer-routing.md`): every ticket names what it was written
 * from, and a ticket whose premise moved is flagged so the Executor refreshes, closes or reopens it before dispatch.
 * Everything here is deterministic; only the rewrite of a flagged ticket needs a model.
 */
export type TicketPremises = {
  decisions: string[];
  specs: string[];
  owns: string[];
  contextSha: string | null;
};

export type Ticket = { number: number; title?: string; body: string; state?: string };

export type PremiseReason =
  | { kind: 'decision_unknown'; decision: string }
  | { kind: 'decision_revised' | 'decision_superseded'; decision: string; current: string }
  | { kind: 'decision_mooted'; decision: string; feedback: string }
  | { kind: 'context_sha_missing' }
  | { kind: 'context_sha_unknown'; sha: string }
  | { kind: 'spec_changed' | 'owned_changed'; files: string[] }
  | { kind: 'git_failed'; error: string };

export type TicketVerdict = { ticket: number; title?: string; premises: TicketPremises; reasons: PremiseReason[] };

/** `unchecked` tickets name no premise at all, so nothing about them could be verified. */
export type PremiseReport = { checked: number; flagged: TicketVerdict[]; clean: number[]; unchecked: number[] };

/** Files under `paths` that changed between `sha` and HEAD; null when the repository does not know `sha`; throws on a git failure. */
export type ChangedSince = (sha: string, paths: string[]) => string[] | null;

const KEY_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?(decisions|spec|owns|context-sha)(?:\*\*)?\s*:\s*(?:\*\*\s*)?(.*)$/i;

function listValues(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((value) => value.replace(/^`|`$/g, '').trim())
    .filter((value) => value.length > 0);
}

/** Read the `Decisions:`, `Spec:`, `Owns:` and `context-sha:` lines of a ticket body; repeated lines accumulate. */
export function parsePremises(body: string): TicketPremises {
  const premises: TicketPremises = { decisions: [], specs: [], owns: [], contextSha: null };
  for (const line of body.split(/\r?\n/)) {
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!;
    if (key === 'decisions') premises.decisions.push(...(value.match(/\bD-[0-9]{2,}\b/g) ?? []));
    else if (key === 'spec') premises.specs.push(...listValues(value));
    else if (key === 'owns') premises.owns.push(...listValues(value));
    else premises.contextSha = /\b[0-9a-f]{7,40}\b/i.exec(value)?.[0]?.toLowerCase() ?? premises.contextSha;
  }
  const unique = (values: string[]): string[] => [...new Set(values)];
  return {
    ...premises,
    decisions: unique(premises.decisions),
    specs: unique(premises.specs),
    owns: unique(premises.owns),
  };
}

/** The decision that now stands in place of `decision`, following `supersedes` links forward; itself when current. */
function currentDecision(decision: DesignDecision, supersededBy: Map<string, DesignDecision>): DesignDecision {
  let current = decision;
  const seen = new Set<string>([current.id]);
  for (let next = supersededBy.get(current.id); next && !seen.has(next.id); next = supersededBy.get(current.id)) {
    seen.add(next.id);
    current = next;
  }
  return current;
}

/** The ledger rejection that took the decision's answer back: its chosen option rejected, or its Command withdrawn. */
function mootedBy(decision: DesignDecision, ledger: FeedbackLedger): string | null {
  const commands = new Set([decision.checkpoint_id, decision.decision_id]);
  // A rejection recorded before the decision cannot have taken it back.
  const entry = ledger.entries.find(
    (candidate) =>
      Date.parse(candidate.at) > Date.parse(decision.at) &&
      (candidate.withdrawn.commands.some((command) => commands.has(command)) ||
        (candidate.rejected.command !== null &&
          commands.has(candidate.rejected.command) &&
          candidate.rejected.options.some((option) => option.id === decision.chosen))),
  );
  return entry?.id ?? null;
}

export function sweepPremises(input: {
  tickets: Ticket[];
  decisions: DesignDecision[];
  ledger: FeedbackLedger;
  changedSince: ChangedSince;
}): PremiseReport {
  const byId = new Map(input.decisions.map((decision) => [decision.id, decision]));
  // Oldest first, so a later re-answer of the same decision wins.
  const supersededBy = new Map<string, DesignDecision>();
  for (const decision of [...input.decisions].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (decision.supersedes !== null) supersededBy.set(decision.supersedes, decision);
  }

  const open = input.tickets.filter((ticket) => ticket.state === undefined || ticket.state.toUpperCase() === 'OPEN');
  const flagged: TicketVerdict[] = [];
  const clean: number[] = [];
  const unchecked: number[] = [];
  for (const ticket of open) {
    const premises = parsePremises(ticket.body);
    if (
      premises.decisions.length + premises.specs.length + premises.owns.length === 0 &&
      premises.contextSha === null
    ) {
      unchecked.push(ticket.number);
      continue;
    }
    const reasons: PremiseReason[] = [];

    for (const id of premises.decisions) {
      const decision = byId.get(id);
      if (!decision) {
        reasons.push({ kind: 'decision_unknown', decision: id });
        continue;
      }
      const current = currentDecision(decision, supersededBy);
      if (current.id !== id)
        reasons.push({
          kind: current.chosen === decision.chosen ? 'decision_superseded' : 'decision_revised',
          decision: id,
          current: current.id,
        });
      const feedback = mootedBy(decision, input.ledger);
      if (feedback !== null) reasons.push({ kind: 'decision_mooted', decision: id, feedback });
    }

    if (premises.specs.length > 0 || premises.owns.length > 0) {
      if (premises.contextSha === null) reasons.push({ kind: 'context_sha_missing' });
      else {
        const files = [
          { kind: 'spec_changed' as const, paths: premises.specs },
          { kind: 'owned_changed' as const, paths: premises.owns },
        ];
        for (const { kind, paths } of files) {
          if (paths.length === 0) continue;
          let changed: string[] | null;
          try {
            changed = input.changedSince(premises.contextSha, paths);
          } catch (error) {
            reasons.push({ kind: 'git_failed', error: error instanceof Error ? error.message : String(error) });
            break;
          }
          if (changed === null) {
            reasons.push({ kind: 'context_sha_unknown', sha: premises.contextSha });
            break;
          }
          if (changed.length > 0) reasons.push({ kind, files: changed });
        }
      }
    }

    if (reasons.length === 0) clean.push(ticket.number);
    else
      flagged.push({
        ticket: ticket.number,
        ...(ticket.title === undefined ? {} : { title: ticket.title }),
        premises,
        reasons,
      });
  }
  return { checked: open.length, flagged, clean, unchecked };
}
