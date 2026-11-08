import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { CommandError } from '../command.js';

/**
 * The game's decision record (#595): every product question an agent has put to the creator, by topic, versioned with
 * the game beside the feedback ledger so the next agent sees what was already asked. A topic in the record is asked
 * once; asking it again needs the creator to have reopened it. `design/decisions.json` is not a design doc; the build's
 * design fold skips it (`packages/sdk/src/vite/index.ts`).
 */
export const DECISIONS_FILE = 'design/decisions.json';

export const DecisionEntry = z
  .object({
    command: z.string().regex(/^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    topic: z.string().trim().min(1).max(80),
    question: z.string().trim().min(1).max(2000),
    options: z.array(z.string().trim().min(1).max(32)).min(2),
    recommend: z.string().trim().min(1).max(32),
    at: z.string().datetime({ offset: true }),
    // The earlier Command this one reopens, when the creator asked to revisit a settled topic.
    revisits: z
      .string()
      .regex(/^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$/)
      .optional(),
  })
  .strict();
export type DecisionEntry = z.infer<typeof DecisionEntry>;

export const DecisionRecord = z
  .object({
    schemaVersion: z.literal(1),
    decisions: z.array(DecisionEntry),
  })
  .strict();
export type DecisionRecord = z.infer<typeof DecisionRecord>;

/** Case and spacing never make a new topic: "Hero Jump" and "hero  jump" are one question. */
export function topicKey(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Read the record; a game that has asked nothing yet reads as empty rather than failing. */
export function readDecisions(gameDir: string): DecisionRecord {
  const file = join(gameDir, DECISIONS_FILE);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, decisions: [] };
    throw new CommandError(`cannot read ${DECISIONS_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new CommandError(
      `${DECISIONS_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = DecisionRecord.safeParse(value);
  if (!parsed.success) throw new CommandError(`${DECISIONS_FILE} is not a valid record: ${parsed.error.message}`);
  return parsed.data;
}

/** The latest Command asked under this topic, if any. */
export function askedUnder(record: DecisionRecord, topic: string): DecisionEntry | undefined {
  const key = topicKey(topic);
  return [...record.decisions].reverse().find((entry) => topicKey(entry.topic) === key);
}

export function appendDecision(gameDir: string, entry: DecisionEntry): void {
  const record = readDecisions(gameDir);
  const file = join(gameDir, DECISIONS_FILE);
  try {
    mkdirSync(dirname(file), { recursive: true });
    const next = DecisionRecord.parse({ ...record, decisions: [...record.decisions, entry] });
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  } catch (error) {
    throw new CommandError(`cannot write ${DECISIONS_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
