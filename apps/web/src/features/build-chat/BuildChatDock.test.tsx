import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient } from '../../app/query';
import { AIUR_CONVERSATION_TAG } from '../aiur/embed';
import { BuildChatDock } from './BuildChatDock';
import { useDock } from './dock';
import { buildChatJob } from './test-fixtures';

const jobState = vi.hoisted(() => ({ jobs: [] as unknown[] }));
const api = vi.hoisted(() => vi.fn());
const chatListeners = vi.hoisted(() => new Map<string, (message: Record<string, unknown>, sequence: number) => void>());

vi.mock('./jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./jobs')>()),
  cancelJob: vi.fn(),
  useBudgetUnitLabel: () => 'coins',
  useMyJobs: () => ({ jobs: jobState.jobs }),
}));

vi.mock('../../lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/client')>()),
  api,
}));

vi.mock('./stream', async (importOriginal) => {
  const original = await importOriginal<typeof import('./stream')>();
  return {
    ...original,
    subscribeChat: vi.fn(
      (jobId: string, _since: number, listener: (message: Record<string, unknown>, sequence: number) => void) => {
        chatListeners.set(jobId, listener);
        return () => chatListeners.delete(jobId);
      },
    ),
  };
});

beforeEach(() => {
  useDock.getState().reset();
  api.mockReset();
  jobState.jobs = [];
  chatListeners.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BuildChatDock', () => {
  it('remounts chat state when switching jobs', async () => {
    const first = buildChatJob({ id: 'j_first' });
    const second = buildChatJob({ id: 'j_second', plan: { ...first.plan, title: 'Second build' } });
    jobState.jobs = [first, second];
    renderDock();

    act(() => useDock.getState().openChat(first.id, [first, second]));
    await waitFor(() => expect(chatListeners.has(first.id)).toBe(true));
    act(() =>
      chatListeners.get(first.id)?.(
        {
          id: 'm_old',
          job_id: first.id,
          at: '2026-11-01T09:00:00Z',
          actor: 'agent',
          kind: 'text',
          text: 'Old job message',
        },
        1,
      ),
    );
    expect(screen.getByText('Old job message')).toBeInTheDocument();

    act(() => useDock.getState().openChat(second.id, [first, second]));

    expect(screen.queryByText('Old job message')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Second build' })).toBeInTheDocument();
  });

  it('starts an edit job from a draft chat when no job is running, then streams it', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    api.mockResolvedValue({ jobId: 'j_new', state: 'admitted' });
    renderDock();

    act(() => useDock.getState().startEdit({ gameId: 'g_1', branchId: 'v2', title: 'Goblin Cellar' }));
    expect(screen.getByRole('heading', { name: 'Goblin Cellar' })).toBeInTheDocument();
    send('Make the door glow');

    await waitFor(() => expect(chatListeners.has('j_new')).toBe(true));
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('/jobs', {
      method: 'POST',
      json: expect.objectContaining({ gameId: 'g_1', branchId: 'v2', kind: 'feature', start: 'now' }),
    });
    // The instruction stays on screen while the new job streams into the same chat.
    expect(screen.getByText('Make the door glow')).toBeInTheDocument();
    expect(useDock.getState()).toMatchObject({ view: 'chat', openJobId: 'j_new' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['game-jobs', 'g_1'] });

    send('And make it creak');
    await waitFor(() =>
      expect(api).toHaveBeenLastCalledWith('/jobs/j_new/chat', { method: 'POST', json: { text: 'And make it creak' } }),
    );
  });

  it('posts into the running job instead of starting another one', async () => {
    const running = buildChatJob({ gameId: 'g_1', branchId: 'main' });
    jobState.jobs = [running];
    api.mockResolvedValue({ id: 'm_1', job_id: running.id, at: '', actor: 'creator', kind: 'text', text: 'Hi' });
    renderDock();

    act(() => useDock.getState().startEdit({ gameId: 'g_1', branchId: 'main', title: 'Goblin Cellar' }));
    send('Hi');

    await waitFor(() => expect(api).toHaveBeenCalledWith(`/jobs/${running.id}/chat`, expect.anything()));
    expect(api).not.toHaveBeenCalledWith('/jobs', expect.anything());
  });

  it('starts an edit job from the chat of a finished build', async () => {
    const finished = buildChatJob({ id: 'j_old', state: 'done' });
    jobState.jobs = [finished];
    api.mockResolvedValue({ jobId: 'j_new', state: 'queued' });
    renderDock();

    act(() => useDock.getState().openChat(finished.id, [finished]));
    send('Add a second door');

    await waitFor(() => expect(chatListeners.has('j_new')).toBe(true));
    expect(api).toHaveBeenCalledWith(
      '/jobs',
      expect.objectContaining({ json: expect.objectContaining({ gameId: finished.gameId, kind: 'feature' }) }),
    );
  });

  it('offers the scope chat over-budget actions and an admin retry for the edit slot', async () => {
    const refused = Object.assign(new Error('refused'), {
      status: 402,
      body: {
        error: 'allowance_exceeded',
        remainingMicroUsd: 100,
        resetsAt: '2026-11-03T07:00:00.000Z',
        offers: ['trim', 'queue', 'ask_admin'],
      },
    });
    api.mockImplementation(async (path: string, init?: { json?: { start?: string } }) => {
      if (path === '/budget/status') {
        return {
          remainingMicroUsd: 100,
          remainingPercent: 1,
          unitLabel: 'coins',
          resetsAt: '2026-11-03T07:00:00.000Z',
          freeSlots: { new_game: 0, edit: 1 },
          queued: [],
        };
      }
      if (init?.json?.start === 'at_reset') return { jobId: 'j_queued', state: 'queued' };
      throw refused;
    });
    renderDock();

    act(() => useDock.getState().startEdit({ gameId: 'g_1', branchId: 'main', title: 'Goblin Cellar' }));
    send('Make the door glow');

    fireEvent.click(await screen.findByRole('button', { name: 'Ask an admin' }));
    expect(await screen.findByText(/remain/)).toBeInTheDocument();
    // Enabled only because the edit slot (not the new-game slot) has room.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(api).toHaveBeenCalledWith('/budget/status');
  });

  it('explains an Energy block by its window and keeps it, not the member allowance, while waiting on an admin', async () => {
    const refused = Object.assign(new Error('refused'), {
      status: 402,
      body: {
        error: 'energy_limit_reached',
        window: 'week',
        remainingMicroUsd: 0,
        resetsAt: '2026-11-09T08:00:00.000Z',
        offers: ['ask_admin'],
      },
    });
    api.mockImplementation(async (path: string) => {
      if (path === '/budget/status') {
        return {
          remainingMicroUsd: 5_000_000,
          remainingPercent: 100,
          unitLabel: 'coins',
          resetsAt: '2026-11-03T07:00:00.000Z',
          freeSlots: { new_game: 0, edit: 0 },
          queued: [],
        };
      }
      throw refused;
    });
    renderDock();

    act(() => useDock.getState().startEdit({ gameId: 'g_1', branchId: 'main', title: 'Goblin Cellar' }));
    send('Make the door glow');

    expect(await screen.findByRole('alert')).toHaveTextContent('This build needs more Energy than is left this week.');
    expect(screen.queryByRole('button', { name: 'Queue for the reset' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask an admin' }));
    const status = await screen.findByRole('region', { name: 'Allowance status' });
    expect(status).toHaveTextContent('This build needs more Energy than is left this week.');
    expect(status).toHaveTextContent(new Date('2026-11-09T08:00:00.000Z').toLocaleString());
    expect(status).not.toHaveTextContent(/remain/);
    // The admin may raise the limit at any time; admission re-checks on retry.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('queues the refused message for the allowance reset', async () => {
    api
      .mockRejectedValueOnce({
        status: 402,
        body: {
          error: 'allowance_exceeded',
          remainingMicroUsd: 0,
          resetsAt: '2026-11-03T07:00:00.000Z',
          offers: ['queue'],
        },
      })
      .mockResolvedValueOnce({ jobId: 'j_queued', state: 'queued' });
    renderDock();

    act(() => useDock.getState().startEdit({ gameId: 'g_1', branchId: 'main', title: 'Goblin Cellar' }));
    send('Make the door glow');
    fireEvent.click(await screen.findByRole('button', { name: 'Queue for the reset' }));

    await waitFor(() => expect(chatListeners.has('j_queued')).toBe(true));
    expect(api.mock.calls[1]![1]).toMatchObject({
      json: { start: 'at_reset', plan: { summary: 'Make the door glow' } },
    });
  });

  it('reuses the admission key when the same message is sent again after a lost response', async () => {
    api
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce({ jobId: 'j_new', state: 'admitted' });
    renderDock();

    act(() => useDock.getState().startEdit({ gameId: 'g_1', branchId: 'main', title: 'Goblin Cellar' }));
    send('Make the door glow');
    expect(await screen.findByText('Message not sent. Try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(chatListeners.has('j_new')).toBe(true));
    const keys = api.mock.calls.map(([, init]) => (init as { json: { idempotencyKey: string } }).json.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('starts the refused edit when the admin retry succeeds', async () => {
    let admitted = false;
    api.mockImplementation(async (path: string) => {
      if (path === '/budget/status') {
        return {
          remainingMicroUsd: 100,
          remainingPercent: 1,
          unitLabel: 'coins',
          resetsAt: '2026-11-03T07:00:00.000Z',
          freeSlots: { new_game: 0, edit: 1 },
          queued: [],
        };
      }
      if (admitted) return { jobId: 'j_retry', state: 'admitted' };
      admitted = true;
      throw {
        status: 402,
        body: {
          error: 'allowance_exceeded',
          remainingMicroUsd: 100,
          resetsAt: '2026-11-03T07:00:00.000Z',
          offers: ['ask_admin'],
        },
      };
    });
    renderDock();

    act(() => useDock.getState().startEdit({ gameId: 'g_1', branchId: 'main', title: 'Goblin Cellar' }));
    send('Make the door glow');
    fireEvent.click(await screen.findByRole('button', { name: 'Ask an admin' }));
    await screen.findByText(/remain/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(chatListeners.has('j_retry')).toBe(true));
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('leaves the dock closed when an admission finishes after the chat was closed', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    api.mockReturnValue(new Promise((done) => (resolve = done)));
    renderDock();

    act(() => useDock.getState().startEdit({ gameId: 'g_1', branchId: 'main', title: 'Goblin Cellar' }));
    send('Make the door glow');
    act(() => useDock.getState().close([]));
    await act(async () => resolve({ jobId: 'j_late', state: 'admitted' }));

    expect(useDock.getState()).toMatchObject({ view: 'collapsed', openJobId: undefined });
  });

  // Editor feature scoping keeps its job list but hands the conversation to aiur's element once installed (#478, A2).
  it('hands the scoped job conversation to aiur’s element when installed', () => {
    if (!customElements.get(AIUR_CONVERSATION_TAG)) {
      customElements.define(AIUR_CONVERSATION_TAG, class extends HTMLElement {});
    }
    const job = buildChatJob();
    jobState.jobs = [job];
    renderDock();

    act(() => useDock.getState().openChat(job.id, [job]));

    const element = document.querySelector(AIUR_CONVERSATION_TAG);
    expect(element).not.toBeNull();
    expect(element).toHaveProperty('scope.conversation', `/api/v1/jobs/${job.id}/chat/messages`);
    expect(element).toHaveProperty('scope.tickets', ['57']);
    expect(document.querySelector('.build-chat-landscape-list')).not.toBeNull();
  });
});

function renderDock() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <BuildChatDock />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function send(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message the builder' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}
