import type { OptionAspect, OptionProvenance } from '@ogm/contracts';

import type { FeedbackLedger, FeedbackMust, FeedbackScope } from './ledger.js';

/** An option an agent is about to show, or an option already shown that a later check reads back. */
export type OptionUnderCheck = {
  id: string;
  label: string;
  /** The Command id the option belongs to, when known. */
  command?: string | null;
  provenance?: OptionProvenance;
};

export type ViolationKind = 'missing-provenance' | 'withdrawn' | 'rejected' | 'breaks-rule' | 'predates-rule';

export type OptionViolation = {
  kind: ViolationKind;
  entry_id: string;
  option_id: string;
  detail: string;
};

export type CheckResult = { ok: boolean; violations: OptionViolation[] };

/** A rule applies to an option when its scope is "options" (every option) or matches the option's design aspect. */
export function scopeApplies(scope: FeedbackScope, aspect: OptionAspect | undefined): boolean {
  if (scope === 'options') return true;
  return aspect === scope;
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

/**
 * The flaw is the maker, not the label: an option whose provenance names the same generator and the same packs is the
 * same thing under a new name. Siblings that share only the flaw's kind or view are caught by the rule instead.
 */
export function sharesFlaw(rejected: OptionProvenance, candidate: OptionProvenance): boolean {
  if (rejected.generator !== candidate.generator) return false;
  if (rejected.packs.length === 0 || candidate.packs.length === 0) return false;
  return sameSet(rejected.packs, candidate.packs);
}

/** True when the option's provenance fails a requirement the rule names. */
export function breaksMust(must: FeedbackMust, provenance: OptionProvenance): boolean {
  if (must.packs !== undefined) {
    if (provenance.packs.length === 0) return true;
    const allowed = new Set(must.packs);
    if (provenance.packs.some((pack) => !allowed.has(pack))) return true;
  }
  if (must.assets !== undefined) {
    const allowed = new Set(must.assets);
    if (provenance.assets.some((asset) => !allowed.has(asset))) return true;
  }
  if (must.kinds !== undefined && (provenance.kind === undefined || !must.kinds.includes(provenance.kind))) return true;
  if (must.views !== undefined && (provenance.view === undefined || !must.views.includes(provenance.view))) return true;
  return false;
}

function when(at: string): string {
  return at.slice(0, 10);
}

/**
 * Fail an option that breaks a ledger rule, matches a rejected option (by id or by provenance), or predates a rule
 * that applies to it. A ledger-carrying game also fails an option with no provenance at all: an option nobody can
 * check is not an option the creator can trust.
 */
export function checkOption(option: OptionUnderCheck, ledger: FeedbackLedger): OptionViolation[] {
  if (ledger.entries.length === 0) return [];
  const violations: OptionViolation[] = [];
  let missingReported = false;
  for (const entry of ledger.entries) {
    const applies = scopeApplies(entry.scope, option.provenance?.aspect);
    if (entry.withdrawn.options.includes(option.id)) {
      violations.push({
        kind: 'withdrawn',
        entry_id: entry.id,
        option_id: option.id,
        detail: `option "${option.id}" was withdrawn by the ${when(entry.at)} rejection; use a new option id`,
      });
    }
    if (option.command && entry.withdrawn.commands.includes(option.command)) {
      violations.push({
        kind: 'withdrawn',
        entry_id: entry.id,
        option_id: option.id,
        detail: `Command "${option.command}" was withdrawn by the ${when(entry.at)} rejection`,
      });
    }
    if (entry.rejected.options.some((rejected) => rejected.id === option.id)) {
      violations.push({
        kind: 'rejected',
        entry_id: entry.id,
        option_id: option.id,
        detail: `option "${option.id}" is the rejected option from ${when(entry.at)}`,
      });
    }
    if (
      option.provenance &&
      entry.rejected.options.some(
        (rejected) => rejected.provenance && sharesFlaw(rejected.provenance, option.provenance!),
      )
    ) {
      violations.push({
        kind: 'rejected',
        entry_id: entry.id,
        option_id: option.id,
        detail: `option "${option.id}" is built the same way as a rejected option (${entry.rule})`,
      });
    }
    if (option.provenance === undefined) {
      if (!missingReported) {
        missingReported = true;
        violations.push({
          kind: 'missing-provenance',
          entry_id: entry.id,
          option_id: option.id,
          detail: `option "${option.id}" records no provenance, so it cannot be checked against the ledger`,
        });
      }
      continue;
    }
    if (applies && breaksMust(entry.must, option.provenance)) {
      violations.push({
        kind: 'breaks-rule',
        entry_id: entry.id,
        option_id: option.id,
        detail: `option "${option.id}" breaks the ${when(entry.at)} rule: ${entry.rule}`,
      });
    }
    if (applies && Date.parse(option.provenance.built_at) < Date.parse(entry.at)) {
      violations.push({
        kind: 'predates-rule',
        entry_id: entry.id,
        option_id: option.id,
        detail: `option "${option.id}" was built ${when(option.provenance.built_at)}, before the ${when(entry.at)} rule: ${entry.rule}`,
      });
    }
  }
  return violations;
}

export function checkOptions(options: OptionUnderCheck[], ledger: FeedbackLedger): CheckResult {
  const violations = options.flatMap((option) => checkOption(option, ledger));
  return { ok: violations.length === 0, violations };
}
