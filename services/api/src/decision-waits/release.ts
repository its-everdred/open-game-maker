import type { AiurClient, Decision } from '@ogm/aiur-client';
import { decisionKeyFromMarker, waitsFromText } from '@ogm/contracts';

import { answeredOption } from '../checkpoints/correlate.js';
import type { WaitingTicket, WaitTickets } from './tickets.js';

// Releasing the tickets that wait on a decision (#680). When a decision is answered, every ticket labelled with its id
// or its key gets the answer written in, is reopened if closed, resumed if paused and queued, so its worker starts with
// the answer in its first prompt (aiur reads issue comments after the workpad into it). A ticket that waits for one
// option and got another is closed as not planned. Then the label is deleted. Only labelled tickets are touched.

// The answer the worker reads: a hidden marker naming the decision, then the answer as JSON.
export const ANSWER_MARKER = (decisionId: string) => `<!-- gm-decision-answer:${decisionId} -->`;

export type DecisionAnswerNote = {
  decision_id: string;
  key: string | null;
  question: string;
  option_id: string | null;
  option_label: string | null;
  // The free answer: a review deck's per-option thumbs and notes (a JSON object) or the creator's own words.
  response: unknown;
};

export function answerNote(decision: Decision): DecisionAnswerNote {
  const optionId = answeredOption(decision) ?? null;
  const raw = (decision.active_answer ?? decision.answer)?.custom_response ?? null;
  let response: unknown = raw;
  if (raw !== null) {
    try {
      response = JSON.parse(raw) as unknown;
    } catch {
      response = raw;
    }
  }
  return {
    decision_id: decision.decision_id,
    key: decisionKeyFromMarker(decision.context?.long_context_markdown),
    question: decision.question,
    option_id: optionId,
    option_label: decision.options.find(({ id }) => id === optionId)?.label ?? null,
    response,
  };
}

function answerComment(note: DecisionAnswerNote): string {
  const picked = note.option_label ?? note.option_id ?? 'a written answer';
  return [
    ANSWER_MARKER(note.decision_id),
    `The creator answered "${note.question}": ${picked}. This ticket waited on it and is queued again.`,
    '',
    '```json gm-decision-answer',
    JSON.stringify(note, null, 2),
    '```',
  ].join('\n');
}

function notPickedComment(note: DecisionAnswerNote, when: string): string {
  return `${ANSWER_MARKER(note.decision_id)}\nThe creator answered "${note.question}" with ${
    note.option_label ?? note.option_id ?? 'a written answer'
  }, not \`${when}\`, so this follow-up is not needed.`;
}

export function isAnswered(decision: Decision): boolean {
  return (decision.active_answer ?? decision.answer) != null;
}

// The keys a decision answers: its own id and the key its Command carries.
export function keysOf(decision: Decision): string[] {
  const key = decisionKeyFromMarker(decision.context?.long_context_markdown);
  return key === null || key === decision.decision_id ? [decision.decision_id] : [decision.decision_id, key];
}

const PAUSED = /:paused(?:-|$)/;

async function releaseTicket(
  client: AiurClient,
  tickets: WaitTickets,
  repo: string,
  key: string,
  ticket: WaitingTicket,
  note: DecisionAnswerNote,
): Promise<'queued' | 'closed'> {
  const text = ticket.comments.join('\n');
  // The last wait the ticket declared on this key decides; a ticket labelled by hand waits for any answer.
  const when = waitsFromText(text)
    .filter((wait) => wait.key === key)
    .at(-1)?.when;
  // A retry after a failure part-way must not write the answer twice.
  const written = text.includes(ANSWER_MARKER(note.decision_id));
  if (when !== undefined && when !== note.option_id) {
    if (!written) await tickets.comment(repo, ticket.number, notPickedComment(note, when));
    if (ticket.open) await tickets.setOpen(repo, ticket.number, false);
    return 'closed';
  }
  if (!written) await tickets.comment(repo, ticket.number, answerComment(note));
  if (!ticket.open) await tickets.setOpen(repo, ticket.number, true);
  const id = String(ticket.number);
  if (ticket.labels.some((label) => PAUSED.test(label))) await client.resume(id);
  await client.nudgeTodo([id]);
  return 'queued';
}

export type Released = { key: string; ticket: number; outcome: 'queued' | 'closed' };

// Releases what one answered decision holds in `repo`. `labelled` is the set of keys with a `waits:` label there (read
// once per poll). Throws on the first failed write, leaving the label in place so the next poll finishes the job.
export async function releaseDecision(
  client: AiurClient,
  tickets: WaitTickets,
  repo: string,
  labelled: ReadonlySet<string>,
  decision: Decision,
): Promise<Released[]> {
  const note = answerNote(decision);
  const released: Released[] = [];
  for (const key of keysOf(decision).filter((candidate) => labelled.has(candidate))) {
    for (const ticket of await tickets.waiting(repo, key)) {
      released.push({
        key,
        ticket: ticket.number,
        outcome: await releaseTicket(client, tickets, repo, key, ticket, note),
      });
    }
    await tickets.deleteLabel(repo, key);
  }
  return released;
}
