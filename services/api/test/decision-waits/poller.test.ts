import type { AiurClient, Decision } from '@ogm/aiur-client';
import { decisionKeyMarker, waitLabel, waitMarker, type DecisionWait } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { createDecisionWaitPoller } from '../../src/decision-waits/poller.js';
import type { WaitingTicket, WaitTickets } from '../../src/decision-waits/tickets.js';

/*
 * #680: a ticket parked on a creator decision must start, with the answer in its first prompt, within one poll of the
 * answer, and no Executor step. Only tickets that declared the decision move; everything else is left alone.
 */

const REPO = 'acme/games';

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    decision_id: 'dec_00000000000000aa',
    version: 1,
    ticket: { identifier: '152' },
    kind: 'direction_checkpoint',
    authority: 'supervisor_allowed',
    blocking: true,
    reversibility: 'reversible',
    question: 'Which diorama?',
    options: [
      { id: 'a', label: 'Meadow' },
      { id: 'b', label: 'Tabletop' },
    ],
    context: { long_context_markdown: `<!-- gm-audience:creator -->\n${decisionKeyMarker('blobs/diorama')}` },
    created_at: '2026-11-09T09:00:00Z',
    decision_status: 'open',
    answer: null,
    ...overrides,
  } as Decision;
}

function answered(option: string, response?: string, overrides: Partial<Decision> = {}): Decision {
  return decision({
    decision_status: 'answered',
    answer: { option_id: option, ...(response === undefined ? {} : { custom_response: response }) },
    ...overrides,
  });
}

type Ticket = WaitingTicket & { waits: string[] };

// An in-memory repository: labels, issues and their comments, with every write logged in order.
function github(seed: { number: number; open?: boolean; labels?: string[]; waits?: DecisionWait[] }[]) {
  const tickets: Ticket[] = seed.map(({ number, open = true, labels = [], waits = [] }) => ({
    number,
    open,
    labels: [...labels, ...waits.map(({ key }) => waitLabel(key))],
    waits: waits.map(({ key }) => key),
    comments: waits.map((wait) => `Waits on decision.\n${waitMarker(wait)}`),
  }));
  const writes: string[] = [];
  const reads = { keys: 0 };
  let failComment: number | null = null;
  const api: WaitTickets = {
    async keys() {
      reads.keys += 1;
      return [...new Set(tickets.flatMap(({ waits }) => waits))];
    },
    async waiting(_repo, key) {
      return tickets
        .filter(({ waits }) => waits.includes(key))
        .map(({ number, open, labels, comments }) => structuredClone({ number, open, labels, comments }));
    },
    async comment(_repo, issue, body) {
      if (failComment === issue) {
        failComment = null;
        throw new Error('GitHub down');
      }
      writes.push(`comment #${issue}`);
      tickets.find(({ number }) => number === issue)!.comments.push(body);
    },
    async setOpen(_repo, issue, open) {
      writes.push(`${open ? 'reopen' : 'close'} #${issue}`);
      tickets.find(({ number }) => number === issue)!.open = open;
    },
    async deleteLabel(_repo, key) {
      writes.push(`delete ${waitLabel(key)}`);
      for (const ticket of tickets) {
        ticket.waits = ticket.waits.filter((wait) => wait !== key);
        ticket.labels = ticket.labels.filter((label) => label !== waitLabel(key));
      }
    },
  };
  return {
    api,
    tickets,
    writes,
    reads,
    failNextComment: (issue: number) => (failComment = issue),
  };
}

function aiur(decisions: () => Decision[]) {
  const calls: string[] = [];
  let failTodo = false;
  const client = {
    async decisions() {
      return decisions();
    },
    async resume(id: string) {
      calls.push(`resume ${id}`);
    },
    async nudgeTodo(ids: string[]) {
      if (failTodo) {
        failTodo = false;
        throw new Error('aiur unavailable');
      }
      calls.push(`todo ${ids.join(',')}`);
    },
  } as unknown as AiurClient;
  return { client, calls, failNextTodo: () => (failTodo = true) };
}

function poller(gh: ReturnType<typeof github>, client: AiurClient) {
  const log: Record<string, unknown>[] = [];
  const instance = createDecisionWaitPoller({
    daemons: async () => [{ slug: 'blobs', repo: REPO }],
    clientFor: async () => client,
    tickets: gh.api,
    log: (line) => log.push(line),
  });
  return { tick: instance.tick, log };
}

function answerJson(comment: string): Record<string, unknown> {
  const match = /```json gm-decision-answer\n([\s\S]+?)\n```/.exec(comment);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!) as Record<string, unknown>;
}

describe('decision waits', () => {
  it('releases a ticket parked on a decision key on the first poll after the answer, with the answer written in', async () => {
    const gh = github([
      { number: 211, labels: ['game:blobs', 'agent:paused'], waits: [{ key: 'blobs/diorama' }] },
      { number: 212, labels: ['game:blobs', 'agent:in-progress'] },
      { number: 213, labels: ['game:blobs', 'agent:paused'], waits: [{ key: 'blobs/staging' }] },
    ]);
    let decisions = [decision()];
    const aiurFake = aiur(() => decisions);
    const { tick } = poller(gh, aiurFake.client);

    await tick();
    expect(aiurFake.calls).toEqual([]);
    expect(gh.writes).toEqual([]);

    const review = JSON.stringify({ a: { thumb: 'down', note: 'too green' }, b: { thumb: 'up' } });
    decisions = [answered('b', review)];
    await tick();

    // Resumed (the pause dropped) and queued, the label gone; the tickets waiting on another decision did not move.
    expect(aiurFake.calls).toEqual(['resume 211', 'todo 211']);
    expect(gh.writes).toEqual(['comment #211', 'delete waits:blobs/diorama']);
    expect(gh.tickets.find(({ number }) => number === 213)!.labels).toContain('waits:blobs/staging');
    // What the worker reads in its first prompt: the pick, its label and the per-option thumbs and notes.
    expect(answerJson(gh.tickets[0]!.comments.at(-1)!)).toEqual({
      decision_id: 'dec_00000000000000aa',
      key: 'blobs/diorama',
      question: 'Which diorama?',
      option_id: 'b',
      option_label: 'Tabletop',
      response: { a: { thumb: 'down', note: 'too green' }, b: { thumb: 'up' } },
    });
  });

  it('releases a ticket that waits on the decision id itself, without resuming one that is not paused', async () => {
    const gh = github([{ number: 40, labels: ['game:blobs'], waits: [{ key: 'dec_00000000000000aa' }] }]);
    const aiurFake = aiur(() => [answered('a', undefined, { context: {} })]);
    await poller(gh, aiurFake.client).tick();
    expect(aiurFake.calls).toEqual(['todo 40']);
    expect(gh.writes).toEqual(['comment #40', 'delete waits:dec_00000000000000aa']);
  });

  it('routes the answer: reopens and queues the follow-up for the picked option, closes the one for the other', async () => {
    const gh = github([
      { number: 50, open: false, labels: ['game:blobs', 'agent:done'], waits: [{ key: 'blobs/diorama', when: 'b' }] },
      { number: 51, labels: ['game:blobs'], waits: [{ key: 'blobs/diorama', when: 'a' }] },
    ]);
    const aiurFake = aiur(() => [answered('b')]);
    await poller(gh, aiurFake.client).tick();

    expect(aiurFake.calls).toEqual(['todo 50']);
    expect(gh.writes).toEqual(['comment #50', 'reopen #50', 'comment #51', 'close #51', 'delete waits:blobs/diorama']);
    expect(gh.tickets[1]!.comments.at(-1)).toContain('not `a`');
  });

  it('reads GitHub once per newly answered decision, not on every poll', async () => {
    const gh = github([{ number: 211, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }] }]);
    const aiurFake = aiur(() => [answered('a')]);
    const { tick } = poller(gh, aiurFake.client);
    await tick();
    await tick();
    expect(gh.reads.keys).toBe(1);
    expect(aiurFake.calls).toEqual(['resume 211', 'todo 211']);
  });

  it('finishes a release that failed part-way on the next poll, without writing the answer twice', async () => {
    const gh = github([
      { number: 211, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }] },
      { number: 214, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }] },
    ]);
    const aiurFake = aiur(() => [answered('a')]);
    const { tick, log } = poller(gh, aiurFake.client);

    aiurFake.failNextTodo();
    await tick();
    expect(log).toContainEqual(expect.objectContaining({ event: 'decision_wait_poll_error', slug: 'blobs' }));
    expect(gh.writes).toEqual(['comment #211']);

    gh.failNextComment(214);
    await tick();
    expect(gh.writes).toEqual(['comment #211']);

    await tick();
    expect(gh.writes).toEqual(['comment #211', 'comment #214', 'delete waits:blobs/diorama']);
    expect(aiurFake.calls).toEqual([
      'resume 211',
      'resume 211',
      'todo 211',
      'resume 211',
      'todo 211',
      'resume 214',
      'todo 214',
    ]);
    expect(gh.tickets[0]!.comments.filter((body) => body.includes('gm-decision-answer:'))).toHaveLength(1);
  });
});
