import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgreedScope, ScopeChoices } from '@ogm/contracts';

import { ApiError } from '../../lib/api/client';
import { useScopeSession } from './useScopeSession';
import type { ScopeTransport } from './transport';

const choices: ScopeChoices = {
  genre: 'Adventure',
  vibe: 'Cozy',
  family: 'smallscaleint',
  world: 'Sky islands',
  players: 'single',
  pov: 'iso',
};

const scope: AgreedScope = {
  session_id: 's_1',
  revision: 1,
  title: 'Midnight Crumbs',
  summary: 'Deliver bread between floating islands.',
  scope: { included: ['three islands'], excluded: [] },
  tickets: [
    {
      key: 'game',
      title: 'Build the game',
      skills: [],
      dependsOn: [],
      acceptanceCriteria: ['A delivery is playable.'],
    },
  ],
  complexity: 2,
  open_questions: [],
  ideas: [],
};

afterEach(() => vi.useRealTimers());

function fakeTransport(): ScopeTransport {
  return {
    createSession: vi.fn().mockResolvedValue({ sessionId: 's_1', jobId: 'j_1' }),
    getSession: vi.fn().mockResolvedValue({ sessionId: 's_1', chatJobId: 'j_1', status: 'agreed', scope }),
    abandonSession: vi.fn().mockResolvedValue(undefined),
    postText: vi.fn().mockResolvedValue({
      id: 'm_2',
      job_id: 'j_1',
      at: '2026-11-02T07:00:00.000Z',
      actor: 'creator',
      kind: 'text',
      text: 'keep it small',
    }),
    subscribe: vi.fn((_jobId, onMessage) => {
      onMessage({
        id: 'm_1',
        job_id: 'j_1',
        at: '2026-11-02T06:59:00.000Z',
        actor: 'agent',
        kind: 'text',
        text: 'Three islands is a good first version.',
      });
      return () => undefined;
    }),
  };
}

describe('useScopeSession', () => {
  it('does not overlap session polls', async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    let resolveFirst!: (value: Awaited<ReturnType<ScopeTransport['getSession']>>) => void;
    const firstPoll = new Promise<Awaited<ReturnType<ScopeTransport['getSession']>>>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(transport.getSession)
      .mockReturnValueOnce(firstPoll)
      .mockResolvedValue({ sessionId: 's_1', chatJobId: 'j_1', status: 'agreed', scope });
    const { unmount } = renderHook(() => useScopeSession('g_1', choices, transport));

    await act(async () => Promise.resolve());
    expect(transport.getSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await Promise.resolve();
    });
    expect(transport.getSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ sessionId: 's_1', chatJobId: 'j_1', status: 'agreed', scope });
      await firstPoll;
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });

    expect(transport.getSession).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('streams builder replies and exposes the agreed plan', async () => {
    const transport = fakeTransport();
    const { result } = renderHook(() => useScopeSession('g_1', choices, transport));

    await waitFor(() => expect(result.current.status).toBe('agreed'));
    expect(result.current.sessionId).toBe('s_1');
    expect(result.current.jobId).toBe('j_1');
    expect(result.current.scope).toEqual(scope);
    expect(result.current.turns).toContainEqual({
      id: 'm_1',
      who: 'builder',
      text: 'Three islands is a good first version.',
    });
  });

  it('posts creator text through the scope job chat', async () => {
    const transport = fakeTransport();
    const { result } = renderHook(() => useScopeSession('g_1', choices, transport));
    await waitFor(() => expect(result.current.jobId).toBe('j_1'));

    await act(async () => result.current.send('keep it small'));

    expect(transport.postText).toHaveBeenCalledWith('j_1', 'keep it small');
    expect(result.current.turns).toContainEqual({ id: 'm_2', who: 'you', text: 'keep it small' });
  });

  // The creation flow's scope chat sends attachments through the same job chat post as the build chat (#222).
  it('posts attachment ids with the creator message', async () => {
    const transport = fakeTransport();
    const { result } = renderHook(() => useScopeSession('g_1', choices, transport));
    await waitFor(() => expect(result.current.jobId).toBe('j_1'));

    await act(async () => result.current.send('use my sketch', ['a_1', 'a_2']));

    expect(transport.postText).toHaveBeenCalledWith('j_1', 'use my sketch', ['a_1', 'a_2']);
  });

  it('abandons the temporary scope session when the creator leaves before Finish', async () => {
    const transport = fakeTransport();
    const { result, unmount } = renderHook(() => useScopeSession('new-draft', choices, transport));
    await waitFor(() => expect(result.current.sessionId).toBe('s_1'));

    unmount();

    expect(transport.abandonSession).toHaveBeenCalledWith('new-draft', 's_1');
  });

  it('abandons a draft if the creator leaves while it is still being created', async () => {
    const transport = fakeTransport();
    let resolveCreate!: (value: { sessionId: string; jobId: string }) => void;
    const creation = new Promise<{ sessionId: string; jobId: string }>((resolve) => {
      resolveCreate = resolve;
    });
    vi.mocked(transport.createSession).mockReturnValue(creation);
    const { unmount } = renderHook(() => useScopeSession('new-draft', choices, transport));

    unmount();
    await act(async () => {
      resolveCreate({ sessionId: 's_1', jobId: 'j_1' });
      await creation;
      await Promise.resolve();
    });

    expect(transport.abandonSession).toHaveBeenCalledWith('new-draft', 's_1');
  });

  it('reports a missing scope route without enabling admission', async () => {
    const transport = fakeTransport();
    vi.mocked(transport.getSession).mockRejectedValue(new ApiError(404, { error: 'not_found' }));
    const { result } = renderHook(() => useScopeSession('g_1', choices, transport));

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.scope).toBeUndefined();
    expect(result.current.error).toContain('unavailable');
  });
});
