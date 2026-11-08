import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { DRIVE_RESULT, type DriveResult } from './drive.js';
import type { QaOpenResult } from './open.js';
import { ROOM_RESULT, type QaRoomResult } from './room.js';

/** A looker reads at most this many images per request; more and the later ones get skimmed. */
export const MAX_LOOK_IMAGES = 6;
export const LOOK_DIR = 'look';
export const QA_REPORT = 'qa-report.md';

export type LookQuestion = { id: string; image: string; text: string };
export type LookRequest = { id: string; images: string[]; questions: LookQuestion[] };

export const lookAnswersSchema = z.record(
  z.string(),
  z.strictObject({ pass: z.boolean(), note: z.string().max(500).default('') }).nullable(),
);
export type LookAnswers = z.infer<typeof lookAnswersSchema>;

type Run = {
  open: QaOpenResult | null;
  journeys: (DriveResult & { dir: string })[];
  rooms: (QaRoomResult & { dir: string })[];
};

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
}

/** Everything `gm qa open`, `drive` and `room` wrote under one run directory. */
export function readRun(runDir: string): Run {
  const run: Run = { open: readJson<QaOpenResult>(join(runDir, 'qa-open.json')), journeys: [], rooms: [] };
  for (const entry of readdirSync(runDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const drive = readJson<DriveResult>(join(runDir, entry.name, DRIVE_RESULT));
    if (drive) run.journeys.push({ ...drive, dir: entry.name });
    const room = readJson<QaRoomResult>(join(runDir, entry.name, ROOM_RESULT));
    if (room) run.rooms.push({ ...room, dir: entry.name });
  }
  return run;
}

/**
 * The look questions for a run: one per journey expect that carries `look` (asked of that step's still), and one per
 * creator rule from the feedback ledger (asked of each journey's last still). Grouped `MAX_LOOK_IMAGES` images a request.
 */
export function lookQuestions(run: Run, rules: readonly string[]): LookQuestion[] {
  const questions: LookQuestion[] = [];
  const lastStills: { owner: string; image: string }[] = [];
  const add = (owner: string, steps: { index: number | string; shot?: string; look?: string; seat?: number }[]) => {
    for (const step of steps) {
      if (step.look && step.shot) {
        const seat = step.seat === undefined ? '' : `@seat${step.seat}`;
        questions.push({ id: `${owner}#${step.index}${seat}`, image: `${owner}/${step.shot}`, text: step.look });
      }
    }
    const last = [...steps].reverse().find((s) => s.shot);
    if (last?.shot) lastStills.push({ owner, image: `${owner}/${last.shot}` });
  };
  for (const journey of run.journeys) add(journey.dir, journey.steps);
  for (const room of run.rooms)
    add(
      room.dir,
      room.checks.flatMap((c) => c.steps.map((s) => ({ ...s, index: `${c.name}.${s.index}` }))),
    );
  for (const [r, rule] of rules.entries()) {
    for (const { owner, image } of lastStills) {
      questions.push({ id: `${owner}#rule${r + 1}`, image, text: `Does this keep the creator's rule: "${rule}"?` });
    }
  }
  return questions;
}

export function groupRequests(questions: readonly LookQuestion[]): LookRequest[] {
  const requests: LookRequest[] = [];
  for (const question of questions) {
    let request = requests.at(-1);
    if (!request || (!request.images.includes(question.image) && request.images.length >= MAX_LOOK_IMAGES)) {
      request = { id: `look-${requests.length + 1}`, images: [], questions: [] };
      requests.push(request);
    }
    if (!request.images.includes(question.image)) request.images.push(question.image);
    request.questions.push(question);
  }
  return requests;
}

/**
 * Writes `look/requests.json` and, the first time, `look/answers.json` with every question unanswered (`null`). The
 * looker opens each request's images, answers `{ "pass": true|false, "note": "..." }` per id, then runs the report.
 */
export function writeLookRequests(
  runDir: string,
  rules: readonly string[],
): { requests: LookRequest[]; answersPath: string } {
  const questions = lookQuestions(readRun(runDir), rules);
  const requests = groupRequests(questions);
  const dir = join(runDir, LOOK_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'requests.json'), `${JSON.stringify(requests, null, 2)}\n`);
  const answersPath = join(dir, 'answers.json');
  const previous = existsSync(answersPath)
    ? lookAnswersSchema.parse(JSON.parse(readFileSync(answersPath, 'utf8')))
    : {};
  const answers: LookAnswers = Object.fromEntries(questions.map((q) => [q.id, previous[q.id] ?? null]));
  writeFileSync(answersPath, `${JSON.stringify(answers, null, 2)}\n`);
  return { requests, answersPath };
}

export type QaVerdict = 'pass' | 'fail' | 'unchecked';
type Row = { step: string; result: 'pass' | 'fail' | 'unchecked'; detail: string };

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function table(rows: Row[]): string[] {
  return [
    '| Step | Result | Detail |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${cell(r.step)} | ${r.result} | ${cell(r.detail)} |`),
  ];
}

/** `qa-report.md`: pass or fail per step for open, each journey and each room, with the look answers folded in. */
export function writeQaReport(runDir: string, rules: readonly string[]): { verdict: QaVerdict; path: string } {
  const run = readRun(runDir);
  const answersPath = join(runDir, LOOK_DIR, 'answers.json');
  const answers = existsSync(answersPath) ? lookAnswersSchema.parse(JSON.parse(readFileSync(answersPath, 'utf8'))) : {};
  const questions = lookQuestions(run, rules);
  const lines: string[] = [];
  const all: Row[] = [];
  const unchecked: string[] = [];
  const lookRow = (q: LookQuestion): Row => {
    const answer = answers[q.id];
    return answer
      ? { step: `look: ${q.text}`, result: answer.pass ? 'pass' : 'fail', detail: `${answer.note} (${q.image})`.trim() }
      : { step: `look: ${q.text}`, result: 'unchecked', detail: q.image };
  };
  const section = (title: string, rows: Row[]) => {
    all.push(...rows);
    lines.push('', `## ${title}`, '', ...table(rows));
  };

  if (run.open) {
    section(
      'Open',
      run.open.viewports.map((v) => ({
        step: `${v.viewport} boot`,
        result: v.failures.length === 0 ? 'pass' : 'fail',
        detail: [
          v.ttiMs === null ? 'never interactive' : `interactive ${v.ttiMs}ms${v.readyHook ? ' (ready hook)' : ''}`,
          v.renderer,
          ...v.failures,
          v.still,
        ].join('; '),
      })),
    );
  }
  for (const journey of run.journeys) {
    const rows: Row[] = journey.steps.map((s) => ({
      step: s.step,
      result: s.ok ? 'pass' : 'fail',
      detail: s.error ?? s.shot ?? '',
    }));
    if (journey.skipped > 0)
      rows.push({ step: `${journey.skipped} later steps`, result: 'fail', detail: 'not run after the failure' });
    rows.push(...questions.filter((q) => q.id.startsWith(`${journey.dir}#`)).map(lookRow));
    section(`Journey ${journey.journey} (${journey.viewport})`, rows);
    unchecked.push(...journey.unchecked.map((u) => `${journey.journey}: ${u}`));
  }
  for (const room of run.rooms) {
    const rows: Row[] = room.checks.map((c) => ({ step: c.name, result: c.ok ? 'pass' : 'fail', detail: c.detail }));
    for (const name of ['host', 'join', 'seated', 'countdown', 'move', 'rejoin'])
      if (!room.checks.some((c) => c.name === name)) rows.push({ step: name, result: 'fail', detail: 'not reached' });
    rows.push(...questions.filter((q) => q.id.startsWith(`${room.dir}#`)).map(lookRow));
    section(`Room ${room.journey} (${room.clients.map((c) => c.viewport).join(', ')})`, rows);
    unchecked.push(...room.unchecked.map((u) => `${room.journey}: ${u}`));
  }

  const verdict: QaVerdict = all.some((r) => r.result === 'fail')
    ? 'fail'
    : all.length === 0 || all.some((r) => r.result === 'unchecked')
      ? 'unchecked'
      : 'pass';
  const head = ['# QA report', '', `Verdict: **${verdict}**`];
  if (run.open) head.push('', `Build: ${run.open.url}`);
  if (unchecked.length > 0) head.push('', `Unchecked: ${unchecked.join('; ')}`);
  const path = join(runDir, QA_REPORT);
  writeFileSync(path, `${[...head, ...lines].join('\n')}\n`);
  return { verdict, path };
}
