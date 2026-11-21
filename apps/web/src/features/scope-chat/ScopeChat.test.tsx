import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import type { AgreedScope, AllowanceExceeded } from '@ogm/contracts';

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  api: vi.fn(),
  scopeSession: vi.fn(),
  session: vi.fn(),
}));

vi.mock('./admit', async () => {
  const actual = await vi.importActual<typeof import('./admit')>('./admit');
  return { ...actual, admitNewGame: mocks.admit };
});
vi.mock('./useScopeSession', () => ({ useScopeSession: mocks.scopeSession }));
vi.mock('../../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, api: mocks.api };
});
vi.mock('../../lib/api/session', () => ({ useSession: mocks.session }));

import { AIUR_CONVERSATION_TAG } from '../aiur/embed';
import { ScopeChat } from './ScopeChat';

const scope: AgreedScope = {
  session_id: 's_1',
  revision: 1,
  title: 'Moonlit Bakery',
  summary: 'Deliver bread at night.',
  scope: { included: ['one village'], excluded: [] },
  tickets: [
    {
      key: 'game',
      title: 'Build it',
      skills: [],
      dependsOn: [],
      acceptanceCriteria: ['One delivery is playable.'],
    },
  ],
  complexity: 2,
  open_questions: [],
  ideas: [],
};

const refusal: AllowanceExceeded = {
  error: 'allowance_exceeded',
  remainingMicroUsd: 1_200_000,
  resetsAt: '2026-11-02T07:00:00.000Z',
  offers: ['queue', 'ask_admin'],
};

beforeEach(() => {
  mocks.admit.mockReset();
  mocks.api.mockReset();
  mocks.session.mockReturnValue({ data: undefined });
  mocks.scopeSession.mockReturnValue({
    sessionId: 's_1',
    jobId: undefined,
    scope,
    turns: [],
    status: 'agreed',
    error: '',
    send: vi.fn(),
    addMessage: vi.fn(),
    retain: vi.fn(),
  });
});

afterEach(() => cleanup());

describe('ScopeChat offers', () => {
  it('submits Finish only once when activated twice before React rerenders', async () => {
    const retain = vi.fn();
    mocks.scopeSession.mockReturnValue({
      sessionId: 's_1',
      jobId: undefined,
      scope,
      turns: [],
      status: 'agreed',
      error: '',
      send: vi.fn(),
      addMessage: vi.fn(),
      retain,
    });
    const onFinish = vi.fn(
      ({ retainDraft }: { retainDraft(): void }) => {
        retainDraft();
        return new Promise<{ kind: 'accepted'; jobId: string }>((resolve) =>
          setTimeout(() => resolve({ kind: 'accepted', jobId: 'j_1' }), 20),
        );
      },
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ScopeChat
            gameId="new-draft"
            choices={{ genre: 'Adventure', vibe: 'Cozy', family: 'smallscaleint', world: 'Sky islands', players: 'single', pov: 'iso' }}
            onFinish={onFinish}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const finish = screen.getByRole('button', { name: 'Finish' });
    act(() => {
      fireEvent.click(finish);
      fireEvent.click(finish);
    });

    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(retain).toHaveBeenCalledTimes(1));
  });

  it('leaves a failed Finish eligible for draft cleanup when the creator leaves', async () => {
    const retain = vi.fn();
    mocks.scopeSession.mockReturnValue({
      sessionId: 's_1',
      jobId: undefined,
      scope,
      turns: [],
      status: 'agreed',
      error: '',
      send: vi.fn(),
      addMessage: vi.fn(),
      retain,
    });
    const onFinish = vi.fn().mockRejectedValue(new Error('game provisioning failed'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ScopeChat
            gameId="new-draft"
            choices={{ genre: 'Adventure', vibe: 'Cozy', family: 'smallscaleint', world: 'Sky islands', players: 'single', pov: 'iso' }}
            onFinish={onFinish}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The build could not be started. Try again.');
    view.unmount();

    expect(retain).not.toHaveBeenCalled();
  });

  it('keeps one voice-token probe across parent rerenders', async () => {
    mocks.session.mockReturnValue({ data: { user: { id: 'u_1' } } });
    mocks.scopeSession.mockReturnValue({
      sessionId: 's_1',
      jobId: 'j_1',
      scope,
      turns: [],
      status: 'agreed',
      error: '',
      send: vi.fn(),
      addMessage: vi.fn(),
    });
    mocks.api.mockResolvedValue({
      token: 'voice-token',
      url: 'wss://voice.example.test',
      expires_at: '2026-11-02T07:01:00.000Z',
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(chat(queryClient));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    rerender(chat(queryClient));
    await act(async () => Promise.resolve());

    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it('queues the same scope for the allowance reset', async () => {
    mocks.admit
      .mockResolvedValueOnce({ kind: 'refused', ...refusal })
      .mockResolvedValueOnce({ kind: 'accepted', jobId: 'j_1' });
    renderChat();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Queue for the reset' }));

    await waitFor(() => expect(mocks.admit).toHaveBeenCalledTimes(2));
    expect(mocks.admit.mock.calls[0]![0]).toMatchObject({ attempt: 1, start: 'now' });
    expect(mocks.admit.mock.calls[1]![0]).toMatchObject({ attempt: 2, start: 'at_reset' });
  });

  it('polls allowance status before enabling an admin retry', async () => {
    mocks.admit.mockResolvedValue({ kind: 'refused', ...refusal });
    mocks.api.mockResolvedValue({
      remainingMicroUsd: 4_000_000,
      remainingPercent: 80,
      unitLabel: 'credits',
      resetsAt: refusal.resetsAt,
      freeSlots: { new_game: 1, edit: 0 },
      queued: [],
    });
    renderChat();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask an admin' }));

    expect(await screen.findByText(/remain/)).toBeVisible();
    expect(mocks.api).toHaveBeenCalledWith('/budget/status');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled();
  });

  // New Game creation hands its job-backed conversation to aiur's element; the admission controls stay OGM's (#478, A2).
  it('hands the job-backed scope conversation to aiur’s element when installed', () => {
    if (!customElements.get(AIUR_CONVERSATION_TAG)) {
      customElements.define(AIUR_CONVERSATION_TAG, class extends HTMLElement {});
    }
    mocks.scopeSession.mockReturnValue({
      sessionId: 's_1',
      jobId: 'j_1',
      scope,
      turns: [],
      status: 'agreed',
      error: '',
      send: vi.fn(),
      addMessage: vi.fn(),
    });

    renderChat();

    const element = document.querySelector(AIUR_CONVERSATION_TAG);
    expect(element).not.toBeNull();
    expect(element).toHaveProperty('scope.conversation', '/api/v1/jobs/j_1/chat/messages');
    expect(element).toHaveProperty('scope.tickets', []);
    expect(screen.getByRole('button', { name: 'Finish' })).toBeVisible();
  });
});

function renderChat() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(chat(queryClient));
}

function chat(queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ScopeChat
          gameId="g_1"
          choices={{
            genre: 'Adventure',
            vibe: 'Cozy',
            family: 'smallscaleint',
            world: 'Sky islands',
            players: 'single',
            pov: 'iso',
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}
