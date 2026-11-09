import { appendFile, copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentOutboxLine } from '@ogm/contracts';
import { describe, expect, it, vi } from 'vitest';

import { loadOutboxHandlers, type OutboxHandler } from '../../src/build-chat/outbox-handlers.js';
import { createOutboxRelay, registerWorkspace, workspaceForJob } from '../../src/build-chat/outbox-relay.js';
import { listSince, parseCommand } from '../../src/build-chat/store.js';
import { chatJob, FIXTURES, jobTable, JOB_ID, makeChatDeps, OTHER_JOB_ID } from './setup.js';

const ULIDS = ['01JBX2Q7M3K8V5N4R6T9W0YZAB', '01JBX2Q7M3K8V5N4R6T9W0YZAC', '01JBX2Q7M3K8V5N4R6T9W0YZAD'];

function line(overrides: Partial<AgentOutboxLine> = {}, payload: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    v: 1,
    id: ULIDS[0],
    job_id: JOB_ID,
    at: '2026-11-01T09:12:30Z',
    type: 'chat.post',
    payload: { kind: 'image', text: 'first room', file: '.gm/outbox/media/tiny.png', ...payload },
    ...overrides,
  })}\n`;
}

async function setup(
  options: {
    handlers?: Map<string, OutboxHandler>;
    jobs?: ReturnType<typeof jobTable> | null;
    registered?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'ogm-chat-root-'));
  const workspace = join(root, 'its-everdred', 'game-repo', '142');
  await mkdir(join(workspace, '.gm', 'outbox', 'media'), { recursive: true });
  await copyFile(fileURLToPath(new URL('tiny.png', FIXTURES)), join(workspace, '.gm/outbox/media/tiny.png'));
  const jobs = options.jobs === undefined ? jobTable(chatJob(), chatJob({ jobId: OTHER_JOB_ID })) : options.jobs;
  const deps = makeChatDeps(jobs ?? undefined);
  if (jobs === null) deps.registry.chatJobs = null;
  if (options.registered !== false) registerWorkspace(deps.sqlite, JOB_ID, workspace);
  const handlers = options.handlers ?? (await loadOutboxHandlers());
  const publish = vi.fn();
  const relay = () =>
    createOutboxRelay({
      root,
      sqlite: deps.sqlite,
      handlers,
      jobs: () => deps.registry.chatJobs,
      log: deps.log,
      context: (jobId, workspaceRoot) => ({
        jobId,
        workspaceRoot,
        db: deps.db,
        sqlite: deps.sqlite,
        blobStore: deps.blobStore,
        publish,
        notify: vi.fn(),
        log: deps.log,
      }),
    });
  const outbox = join(workspace, '.gm/outbox/chat.jsonl');
  const append = (text: string) => appendFile(outbox, text);
  const rejected = () => deps.lines.filter((entry) => entry.event === 'outbox-line-rejected');
  return { root, workspace, deps, relay, append, publish, rejected, jobs };
}

describe('outbox relay', () => {
  it('finds the chat.post handler by directory scan', async () => {
    expect([...(await loadOutboxHandlers()).keys()]).toContain('chat.post');
  });

  // The agent's sandbox has no network: an appended line is the only way its still reaches the creator.
  it('turns a chat.post image line into one agent row with its blob and size', async () => {
    const { deps, relay, append, publish, workspace } = await setup();
    await append(line());
    await relay().scan();
    const rows = listSince(deps.sqlite, JOB_ID, 0);
    expect(rows).toMatchObject([
      { id: ULIDS[0], actor: 'agent', kind: 'image', text: 'first room', width: 64, height: 48 },
    ]);
    expect(await deps.blobStore.head(rows[0]!.mediaHash!)).toMatchObject({ mime: 'image/png' });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(workspaceForJob(deps.sqlite, JOB_ID)).toBe(workspace);
  });

  it('stores a line appended twice once', async () => {
    const { deps, relay, append, publish } = await setup();
    const r = relay();
    await append(line());
    await r.scan();
    await append(line());
    await r.scan();
    expect(listSince(deps.sqlite, JOB_ID, 0)).toHaveLength(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('rejects and logs a line whose file escapes the workspace, then keeps going', async () => {
    const { deps, relay, append, rejected } = await setup();
    await append(line({}, { file: '../../etc/passwd' }) + line({ id: ULIDS[1] }));
    await relay().scan();
    expect(listSince(deps.sqlite, JOB_ID, 0).map((row) => row.id)).toEqual([ULIDS[1]]);
    expect(rejected()).toEqual([expect.objectContaining({ reason: 'outbox_path_outside_workspace', offset: 0 })]);
    expect(JSON.stringify(deps.lines)).not.toContain('passwd');
  });

  it('rejects oversized, malformed and invalid lines without storing anything', async () => {
    const { deps, relay, append, rejected } = await setup();
    await append(line({}, { kind: 'text', text: 'x'.repeat(70 * 1024) }) + 'not json\n' + line({ type: 'chat' }));
    await relay().scan();
    expect(listSince(deps.sqlite, JOB_ID, 0)).toEqual([]);
    expect(rejected().map((entry) => entry.reason)).toEqual(['line_too_large', 'line_not_json', 'line_invalid']);
  });

  it('skips a type nobody handles and logs it once', async () => {
    const { deps, relay, append } = await setup();
    await append(
      line({ type: 'unhandled.test', payload: {} }) + line({ id: ULIDS[1], type: 'unhandled.test', payload: {} }),
    );
    await relay().scan();
    expect(listSince(deps.sqlite, JOB_ID, 0)).toEqual([]);
    expect(deps.lines.filter((entry) => entry.event === 'outbox-type-unhandled')).toEqual([
      expect.objectContaining({ type: 'unhandled.test' }),
    ]);
  });

  it('resumes from the stored offset after a restart and waits for a partial line', async () => {
    const handle = vi.fn(async () => {});
    const handlers = new Map([['custom.thing', { type: 'custom.thing', handle }]]);
    const { relay, append } = await setup({ handlers });
    await append(line({ type: 'custom.thing' }));
    const second = line({ id: ULIDS[1], type: 'custom.thing' });
    await append(second.slice(0, 20));
    await relay().scan();
    expect(handle).toHaveBeenCalledTimes(1);

    await append(second.slice(20));
    await relay().scan(); // a new relay: the first line is not delivered again
    expect(handle.mock.calls.map((call) => (call as unknown as [AgentOutboxLine])[0].id)).toEqual([ULIDS[0], ULIDS[1]]);
  });

  // A trusted launcher registration, not sandbox-authored JSON, decides which job owns the workspace.
  it('rejects a line that names a job other than the workspace registration', async () => {
    const { deps, relay, append, rejected } = await setup();
    await append(
      line({}, { kind: 'text', text: 'mine' }) + line({ id: ULIDS[1], job_id: OTHER_JOB_ID }, { kind: 'text' }),
    );
    await relay().scan();
    expect(listSince(deps.sqlite, OTHER_JOB_ID, 0)).toEqual([]);
    expect(rejected()).toEqual([expect.objectContaining({ reason: 'job_mismatch' })]);
  });

  it('rejects a known job from a workspace the trusted launcher did not register', async () => {
    const { deps, relay, append, rejected } = await setup({ registered: false });
    await append(line({}, { kind: 'text', text: 'claim another workspace' }));
    await relay().scan();
    expect(listSince(deps.sqlite, JOB_ID, 0)).toEqual([]);
    expect(rejected()).toEqual([expect.objectContaining({ reason: 'workspace_unregistered' })]);
  });

  it('rejects a line for a job the directory does not know', async () => {
    const { relay, append, rejected } = await setup({ jobs: jobTable() });
    await append(line({}, { kind: 'text', text: 'hi' }));
    await relay().scan();
    expect(rejected()).toEqual([expect.objectContaining({ reason: 'job_unknown' })]);
  });

  it('leaves lines in place until a job directory is registered', async () => {
    const { deps, relay, append } = await setup({ jobs: null });
    await append(line({}, { kind: 'text', text: 'early' }));
    const r = relay();
    await r.scan();
    expect(listSince(deps.sqlite, JOB_ID, 0)).toEqual([]);
    deps.registry.chatJobs = jobTable(chatJob()).directory;
    await r.scan();
    expect(listSince(deps.sqlite, JOB_ID, 0).map((row) => row.text)).toEqual(['early']);
  });

  it('picks up a new line through the directory watcher without waiting for the rescan', async () => {
    const { deps, relay, append } = await setup();
    const r = relay();
    r.start(60_000);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100)); // let the first pass set up the watcher
      await append(line({}, { kind: 'text', text: 'live' }));
      await vi.waitFor(() => expect(listSince(deps.sqlite, JOB_ID, 0)).toHaveLength(1), { timeout: 3000 });
    } finally {
      r.stop();
    }
  });
  // A job running across the #571 upgrade still has `gm checkpoint open` lines in its outbox. Dropping them would lose
  // the creator's question and leave the build parked, so the Command handler reads them for one release.
  it('turns a pre-rename checkpoint.open line into a Command', async () => {
    const { deps, relay, workspace, publish } = await setup();
    const checkpointLine = {
      v: 1,
      id: ULIDS[0],
      job_id: JOB_ID,
      at: '2026-11-01T09:12:30Z',
      type: 'checkpoint.open',
      payload: {
        checkpoint_id: 'cp_01JBX2R1A2B3C4D5E6F7G8H9JK',
        question: 'Which door?',
        options: [
          { id: 'wood', label: 'Wooden' },
          { id: 'iron', label: 'Iron' },
        ],
        blocking: true,
      },
    };
    await appendFile(join(workspace, '.gm/outbox/checkpoint.jsonl'), `${JSON.stringify(checkpointLine)}\n`);
    await relay().scan();
    const [row] = listSince(deps.sqlite, JOB_ID, 0);
    expect(row?.kind).toBe('command');
    expect(parseCommand(row!)).toMatchObject({ command_id: 'cp_01JBX2R1A2B3C4D5E6F7G8H9JK', status: 'open' });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
