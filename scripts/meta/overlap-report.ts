#!/usr/bin/env node
/** Summarize overlap wakes and reviewed dispositions without guessing classifications. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export type Wake = { wake_id: number; kind: string; first_seen_at: string; message?: string };
export type Disposition = {
  wake_id: number;
  classification: 'duplicate_implementation' | 'overlapping_question_reached_creator' | 'not_duplicate' | 'unknown';
  reviewed_at: string;
  feature?: string;
  finding_evidence?: string;
  finding_id?: string;
  delivery_id?: string;
  reached_at?: string;
  acted_at?: string;
  action_evidence?: string;
};

type Feature = {
  raised_this_hour: number | null;
  acted_this_hour: number | null;
  proposals: { wake_id: number; message: string }[];
  actions: { wake_id: number; evidence: string }[];
  unclassified_this_week: number;
  duplicate_implementations_this_week: number | null;
  overlapping_questions_reaching_creator_this_week: number | null;
  observed_raised_this_hour?: number;
  observed_acted_this_hour?: number;
  confirmed_duplicate_implementations_this_week?: number;
  confirmed_overlapping_questions_reaching_creator_this_week?: number;
  findings: Set<string>;
  deliveries: Set<string>;
};

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error('timestamp needs an offset');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('invalid timestamp');
  return parsed;
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
        return [value as T];
      } catch (error) {
        throw new Error(`${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function emptyFeature(): Feature {
  return {
    raised_this_hour: 0,
    acted_this_hour: 0,
    proposals: [],
    actions: [],
    unclassified_this_week: 0,
    duplicate_implementations_this_week: 0,
    overlapping_questions_reaching_creator_this_week: 0,
    findings: new Set(),
    deliveries: new Set(),
  };
}

/** Unknown coverage and unclassified proposals never become a false zero. */
export function report(
  wakes: Wake[],
  dispositions: Disposition[],
  now: Date,
  featureKeys: string[] = [],
  coverageComplete = false,
) {
  const current = now.getTime();
  const week = current - 7 * 24 * 60 * 60 * 1000;
  const hour = current - 60 * 60 * 1000;
  const indexed = new Map<number, Wake>();
  for (const wake of wakes) {
    if (!['feature_overlap', 'work_overlap', 'creator_question_overlap'].includes(wake.kind)) continue;
    if (!Number.isSafeInteger(wake.wake_id) || wake.wake_id < 1)
      throw new Error('overlap wake needs a positive integer wake_id');
    if (timestamp(wake.first_seen_at) <= current) {
      if (indexed.has(wake.wake_id)) throw new Error(`duplicate overlap wake ${wake.wake_id}`);
      indexed.set(wake.wake_id, wake);
    }
  }
  const classified = new Map<number, Disposition>();
  for (const item of dispositions) {
    if (
      !Number.isSafeInteger(item.wake_id) ||
      item.wake_id < 1 ||
      !['duplicate_implementation', 'overlapping_question_reached_creator', 'not_duplicate', 'unknown'].includes(
        item.classification,
      )
    )
      throw new Error('invalid overlap disposition');
    timestamp(item.reviewed_at);
    if (
      ['duplicate_implementation', 'overlapping_question_reached_creator'].includes(item.classification) &&
      !nonempty(item.finding_evidence)
    )
      throw new Error(`confirmed disposition for wake ${item.wake_id} needs finding_evidence`);
    if (item.classification === 'duplicate_implementation' && !nonempty(item.finding_id))
      throw new Error(`confirmed duplicate for wake ${item.wake_id} needs finding_id`);
    if (item.classification === 'overlapping_question_reached_creator') {
      timestamp(item.reached_at);
      if (!nonempty(item.delivery_id)) throw new Error(`confirmed question for wake ${item.wake_id} needs delivery_id`);
    }
    if (item.acted_at && !nonempty(item.action_evidence))
      throw new Error(`acted disposition for wake ${item.wake_id} needs action_evidence`);
    if (classified.has(item.wake_id)) throw new Error(`duplicate disposition for wake ${item.wake_id}`);
    if (!indexed.has(item.wake_id)) throw new Error(`disposition references missing overlap wake ${item.wake_id}`);
    classified.set(item.wake_id, item);
  }
  const features = new Map<string, Feature>();
  const feature = (key: string) => {
    if (!features.has(key)) features.set(key, emptyFeature());
    return features.get(key)!;
  };
  for (const key of featureKeys) feature(key);
  for (const [id, wake] of indexed) {
    const item = classified.get(id);
    const seen = timestamp(wake.first_seen_at);
    const acted = item?.acted_at ? timestamp(item.acted_at) : null;
    const actedInHour = acted !== null && acted >= hour && acted <= current;
    const classification =
      item &&
      timestamp(item.reviewed_at) <= current &&
      (item.classification !== 'overlapping_question_reached_creator' || timestamp(item.reached_at) <= current)
        ? item.classification
        : 'unknown';
    if (classification === 'duplicate_implementation' && !['feature_overlap', 'work_overlap'].includes(wake.kind))
      throw new Error(`wake ${id} is not a work overlap`);
    if (classification === 'overlapping_question_reached_creator' && wake.kind !== 'creator_question_overlap')
      throw new Error(`wake ${id} is not a question overlap`);
    const confirmedValue =
      classification === 'overlapping_question_reached_creator' ? item?.reached_at : item?.reviewed_at;
    const confirmed = confirmedValue ? timestamp(confirmedValue) : null;
    const confirmedThisWeek = confirmed !== null && confirmed >= week && confirmed <= current;
    if (seen < week && !actedInHour && !confirmedThisWeek) continue;
    const match = /^(?:Within|Across) features? (.+?): /.exec(wake.message ?? '');
    const names = match ? match[1]!.split(',').map((name) => name.trim()) : [item?.feature || 'unassigned'];
    for (const name of names) {
      const row = feature(name);
      if (seen >= hour) {
        row.raised_this_hour!++;
        row.proposals.push({ wake_id: id, message: wake.message ?? '' });
      }
      if (actedInHour) {
        row.acted_this_hour!++;
        row.actions.push({ wake_id: id, evidence: item!.action_evidence! });
      }
      if (classification === 'unknown' && seen >= week) row.unclassified_this_week++;
      else if (
        classification === 'duplicate_implementation' &&
        confirmedThisWeek &&
        !row.findings.has(item!.finding_id!)
      ) {
        row.duplicate_implementations_this_week!++;
        row.findings.add(item!.finding_id!);
      } else if (
        classification === 'overlapping_question_reached_creator' &&
        confirmedThisWeek &&
        !row.deliveries.has(item!.delivery_id!)
      ) {
        row.overlapping_questions_reaching_creator_this_week!++;
        row.deliveries.add(item!.delivery_id!);
      }
    }
  }
  const unassigned = features.get('unassigned')?.unclassified_this_week ?? 0;
  const result: Record<string, Omit<Feature, 'findings' | 'deliveries'>> = {};
  for (const [key, row] of [...features].sort(([a], [b]) => a.localeCompare(b))) {
    row.observed_raised_this_hour = row.raised_this_hour!;
    row.observed_acted_this_hour = row.acted_this_hour!;
    row.confirmed_duplicate_implementations_this_week = row.duplicate_implementations_this_week!;
    row.confirmed_overlapping_questions_reaching_creator_this_week =
      row.overlapping_questions_reaching_creator_this_week!;
    if (!coverageComplete) {
      row.raised_this_hour = null;
      row.acted_this_hour = null;
    }
    if (!coverageComplete || row.unclassified_this_week || unassigned) {
      row.duplicate_implementations_this_week = null;
      row.overlapping_questions_reaching_creator_this_week = null;
    }
    const { findings: _findings, deliveries: _deliveries, ...output } = row;
    result[key] = output;
  }
  return {
    generated_at: now.toISOString(),
    target_overlapping_questions_per_week: 0,
    features: result,
    coverage: coverageComplete
      ? 'complete only when explicitly verified and no proposals are unclassified'
      : 'incomplete or unverified; weekly metrics are unknown',
  };
}

export function featureKeys(snapshot: unknown): string[] {
  const rows = (snapshot as { features?: unknown } | null)?.features;
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.key !== 'string' || !row.key))
    throw new Error('invalid feature snapshot');
  return rows.map((row) => row.key as string);
}

function main(args: string[]): void {
  const flags = new Map<string, string>();
  let complete = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--coverage-complete') {
      complete = true;
      continue;
    }
    if (!['--wakes', '--dispositions', '--features'].includes(args[i]!) || !args[i + 1])
      throw new Error(
        'usage: overlap-report.ts --features <json> --wakes <ndjson> --dispositions <ndjson> [--coverage-complete]',
      );
    flags.set(args[i]!, args[++i]!);
  }
  for (const name of ['--features', '--wakes', '--dispositions'])
    if (!flags.has(name)) throw new Error(`${name} is required`);
  const result = report(
    readJsonl<Wake>(flags.get('--wakes')!),
    readJsonl<Disposition>(flags.get('--dispositions')!),
    new Date(),
    featureKeys(JSON.parse(readFileSync(flags.get('--features')!, 'utf8'))),
    complete,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`overlap report: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
