import type { AiurClient, Decision } from '@ogm/aiur-client';
import { decisionKeyMarker, waitKeyOfLabel, waitLabel, waitMarker, type DecisionWait } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { createDecisionWaitPoller, LABEL_REREAD_MS } from '../../src/decision-waits/poller.js';
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

type Seed = { number: number; open?: boolean; labels?: string[]; waits?: DecisionWait[]; game?: string };

// An in-memory repository: issues with their labels and comments, every write logged in order. A ticket is `game:blobs`
// unless it names another game.
function github(seed: Seed[]) {
  const tickets: WaitingTicket[] = [];
  const add = ({ number, open = true, labels = [], waits = [], game = 'blobs' }: Seed) =>
    tickets.push({
      number,
      open,
      labels: [`game:${game}`, ...labels, ...waits.map(({ key }) => waitLabel(key))],
      comments: waits.map((wait) => `Waits on decision.\n${waitMarker(wait)}`),
    });
  seed.forEach(add);
  const find = (issue: number) => tickets.find(({ number }) => number === issue)!;
  const writes: string[] = [];
  const reads = { keys: 0 };
  let failComment: number | null = null;
  const api: WaitTickets = {
    async keys() {
      reads.keys += 1;
      return [...new Set(tickets.flatMap(({ labels }) => labels.map(waitKeyOfLabel).filter((key) => key !== null)))];
    },
    async waiting(_repo, key) {
      return tickets.filter(({ labels }) => labels.includes(waitLabel(key))).map((ticket) => structuredClone(ticket));
    },
    async comment(_repo, issue, body) {
      if (failComment === issue) {
        failComment = null;
        throw new Error('GitHub down');
      }
      writes.push(`comment #${issue}`);
      find(issue).comments.push(body);
    },
    async setOpen(_repo, issue, open) {
      writes.push(`${open ? 'reopen' : 'close'} #${issue}`);
      find(issue).open = open;
    },
    async removeLabel(_repo, issue, key) {
      writes.push(`unlabel #${issue} ${waitLabel(key)}`);
      find(issue).labels = find(issue).labels.filter((label) => label !== waitLabel(key));
    },
  };
  return { api, tickets, find, add, writes, reads, failNextComment: (issue: number) => (failComment = issue) };
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

function poller(
  gh: ReturnType<typeof github>,
  client: AiurClient,
  daemons: () => Promise<{ slug: string; repo: string }[]> = async () => [{ slug: 'blobs', repo: REPO }],
) {
  const log: Record<string, unknown>[] = [];
  const clock = { now: 0 };
  const instance = createDecisionWaitPoller({
    daemons,
    clientFor: async () => client,
    tickets: gh.api,
    log: (line) => log.push(line),
    now: () => clock.now,
  });
  return { tick: instance.tick, log, clock };
}

function answerJson(comment: string): Record<string, unknown> {
  const match = /```json gm-decision-answer\n([\s\S]+?)\n```/.exec(comment);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!) as Record<string, unknown>;
}

describe('decision waits', () => {
  it('releases a ticket parked on a decision key on the first poll after the answer, with the answer written in', async () => {
    const gh = github([
      { number: 211, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }] },
      { number: 212, labels: ['agent:in-progress'] },
      { number: 213, labels: ['agent:paused'], waits: [{ key: 'blobs/staging' }] },
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

    // Resumed (the pause dropped) and queued, its wait label off; the ticket waiting on another decision did not move.
    expect(aiurFake.calls).toEqual(['resume 211', 'todo 211']);
    expect(gh.writes).toEqual(['comment #211', 'unlabel #211 waits:blobs/diorama']);
    expect(gh.find(213).labels).toContain('waits:blobs/staging');
    // What the worker reads in its first prompt: the pick, its label and the per-option thumbs and notes.
    expect(answerJson(gh.find(211).comments.at(-1)!)).toEqual({
      decision_id: 'dec_00000000000000aa',
      key: 'blobs/diorama',
      question: 'Which diorama?',
      option_id: 'b',
      option_label: 'Tabletop',
      response: { a: { thumb: 'down', note: 'too green' }, b: { thumb: 'up' } },
    });
  });

  it('releases a ticket that waits on the decision id itself, without resuming one that is not paused', async () => {
    const gh = github([{ number: 40, waits: [{ key: 'dec_00000000000000aa' }] }]);
    const aiurFake = aiur(() => [answered('a', undefined, { context: {} })]);
    await poller(gh, aiurFake.client).tick();
    expect(aiurFake.calls).toEqual(['todo 40']);
    expect(gh.writes).toEqual(['comment #40', 'unlabel #40 waits:dec_00000000000000aa']);
  });

  it('routes the answer: reopens and queues the follow-up for the picked option, closes the one for the other', async () => {
    const gh = github([
      { number: 50, open: false, labels: ['agent:done'], waits: [{ key: 'blobs/diorama', when: 'b' }] },
      { number: 51, waits: [{ key: 'blobs/diorama', when: 'a' }] },
    ]);
    const aiurFake = aiur(() => [answered('b')]);
    await poller(gh, aiurFake.client).tick();

    expect(aiurFake.calls).toEqual(['todo 50']);
    expect(gh.writes).toEqual([
      'comment #50',
      'reopen #50',
      'unlabel #50 waits:blobs/diorama',
      'comment #51',
      'close #51',
      'unlabel #51 waits:blobs/diorama',
    ]);
    expect(gh.find(51).comments.at(-1)).toContain('not `a`');
  });

  // Several games share one instance repository, and each game's aiur releases only its own tickets.
  it("leaves another game's ticket on the same key for that game's own decision", async () => {
    const gh = github([
      { number: 211, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }] },
      { number: 300, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }], game: 'dusk-helm' },
    ]);
    const aiurFake = aiur(() => [answered('a')]);
    await poller(gh, aiurFake.client).tick();
    expect(aiurFake.calls).toEqual(['resume 211', 'todo 211']);
    expect(gh.find(300).labels).toContain('waits:blobs/diorama');
  });

  it('keeps a ticket that waits on two decisions parked until both are answered, with both answers written in', async () => {
    const gh = github([
      { number: 211, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }, { key: 'blobs/staging' }] },
    ]);
    let decisions = [answered('a')];
    const aiurFake = aiur(() => decisions);
    const { tick } = poller(gh, aiurFake.client);
    await tick();
    expect(aiurFake.calls).toEqual([]);
    expect(gh.writes).toEqual(['comment #211', 'unlabel #211 waits:blobs/diorama']);

    const staging = answered('b', undefined, {
      decision_id: 'dec_00000000000000bb',
      context: { long_context_markdown: decisionKeyMarker('blobs/staging') },
    });
    decisions = [answered('a'), staging];
    await tick();
    expect(aiurFake.calls).toEqual(['resume 211', 'todo 211']);
    expect(gh.find(211).comments.filter((body) => body.includes('gm-decision-answer:'))).toHaveLength(2);
  });

  it('releases a ticket parked after its decision was answered, at the next label read', async () => {
    const gh = github([]);
    const aiurFake = aiur(() => [answered('a')]);
    const { tick, clock } = poller(gh, aiurFake.client);
    await tick();
    gh.add({ number: 211, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }] });

    await tick();
    expect(gh.reads.keys).toBe(1);
    clock.now = LABEL_REREAD_MS;
    await tick();
    expect(aiurFake.calls).toEqual(['resume 211', 'todo 211']);
  });

  it('waits on a question asked again under the same key, not on its earlier answer', async () => {
    const gh = github([{ number: 211, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }] }]);
    const asked = decision({ decision_id: 'dec_00000000000000cc', created_at: '2026-11-09T12:00:00Z' });
    const aiurFake = aiur(() => [answered('a'), asked]);
    await poller(gh, aiurFake.client).tick();
    expect(aiurFake.calls).toEqual([]);
    expect(gh.writes).toEqual([]);
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

  it('finishes a release that failed part-way on the next poll, touching only the tickets still waiting', async () => {
    const gh = github([
      { number: 211, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }] },
      { number: 214, labels: ['agent:paused'], waits: [{ key: 'blobs/diorama' }] },
    ]);
    const aiurFake = aiur(() => [answered('a')]);
    const { tick, log } = poller(gh, aiurFake.client);

    aiurFake.failNextTodo();
    await tick();
    expect(log).toContainEqual(expect.objectContaining({ event: 'decision_wait_release_error', key: 'blobs/diorama' }));
    expect(gh.writes).toEqual(['comment #211']);

    await tick();
    expect(gh.writes).toEqual([
      'comment #211',
      'unlabel #211 waits:blobs/diorama',
      'comment #214',
      'unlabel #214 waits:blobs/diorama',
    ]);
    // The answer is written once though the first attempt failed after writing it.
    expect(gh.find(211).comments.filter((body) => body.includes('gm-decision-answer:'))).toHaveLength(1);
    expect(aiurFake.calls).toEqual(['resume 211', 'resume 211', 'todo 211', 'resume 214', 'todo 214']);
  });

  it('logs a daemon list that cannot be read instead of failing the poll', async () => {
    const gh = github([]);
    const { tick, log } = poller(gh, aiur(() => []).client, async () => {
      throw new Error('db closed');
    });
    await expect(tick()).resolves.toBeUndefined();
    expect(log).toContainEqual(expect.objectContaining({ event: 'decision_wait_poll_error' }));
  });
});
