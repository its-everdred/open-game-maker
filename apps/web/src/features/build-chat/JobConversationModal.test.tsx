import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIUR_CONVERSATION_TAG } from '../aiur/embed';
import { JobConversationModal } from './JobConversationModal';
import { useConversation } from './conversation';

const state = vi.hoisted(() => ({
  jobs: [] as Array<{
    id: string;
    gameId: string;
    aiurIssueNumber: number | null;
    state: 'running';
    plan: { title: string };
  }>,
}));

vi.mock('./jobs', () => ({
  useMyJobs: () => ({ jobs: state.jobs, active: state.jobs, games: [] }),
  isTerminal: () => false,
  myJobsQueryKey: ['build-chat', 'jobs'],
}));

vi.mock('./stream', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stream')>()),
  subscribeChat: vi.fn(() => () => undefined),
}));

const calls: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(() => {
  calls.length = 0;
  state.jobs = [{ id: 'j_1', gameId: 'g_1', aiurIssueNumber: 478, state: 'running', plan: { title: 'Moon gate' } }];
  useConversation.setState({ jobId: undefined });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return new Response(JSON.stringify({ status: 'answered' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('JobConversationModal', () => {
  it('stays closed until a job is opened', () => {
    renderModal();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the job conversation with the aiur composer', () => {
    useConversation.getState().open('j_1');
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Moon gate' })).toBeVisible();
    expect(document.querySelector('aiur-composer')).not.toBeNull();
  });

  it('closes on Escape and on the close button', () => {
    useConversation.getState().open('j_1');
    renderModal();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Moon gate' }), { key: 'Escape' });
    expect(useConversation.getState().jobId).toBeUndefined();
  });

  it('closes when the close button is pressed', () => {
    useConversation.getState().open('j_1');
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useConversation.getState().jobId).toBeUndefined();
  });

  it('forwards an answer from aiur’s conversation element to the job command route', async () => {
    if (!customElements.get(AIUR_CONVERSATION_TAG))
      customElements.define(AIUR_CONVERSATION_TAG, class extends HTMLElement {});
    useConversation.getState().open('j_1');
    renderModal();
    document
      .querySelector(AIUR_CONVERSATION_TAG)!
      .dispatchEvent(
        new CustomEvent('aiur-answer', { detail: { job_id: 'j_1', command_id: 'm_3', option_id: 'stone' } }),
      );
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/v1/jobs/j_1/commands/m_3/answer',
        method: 'POST',
        body: { option_id: 'stone' },
      }),
    );
  });
});

function renderModal() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <JobConversationModal />
    </QueryClientProvider>,
  );
}
