import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DesignSnapshot } from '../../../features/editor/api';

const frame = vi.hoisted(() => {
  const controllers: Array<{ dispose: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> }> = [];
  const options: Array<{ onState?(state: { bridgeState: 'ready' | 'error'; dropped: number }): void }> = [];
  return {
    controllers,
    options,
    mountGameFrame: vi.fn((next: (typeof options)[number]) => {
      options.push(next);
      const controller = { dispose: vi.fn(), select: vi.fn() };
      controllers.push(controller);
      return controller;
    }),
  };
});

vi.mock('../../../features/editor/frame', () => ({ mountGameFrame: frame.mountGameFrame }));
vi.mock('../../../features/editor/api', () => ({ requestDraftGrant: vi.fn().mockResolvedValue({ grant: 'grant' }) }));

import { SideBySide } from './SideBySide';

const snapshot = (buildId: string): DesignSnapshot => ({
  buildId,
  rev: 4,
  doc: { schemaVersion: 1, globals: {}, entities: {} },
});

afterEach(() => {
  cleanup();
  frame.controllers.splice(0);
  frame.options.splice(0);
  frame.mountGameFrame.mockClear();
});

describe('SideBySide', () => {
  it('selects after readiness and leaves the other side visible when one frame fails', async () => {
    const view = render(
      <SideBySide
        gameId="game"
        entityId="entity_one"
        mine={snapshot('mine_build')}
        theirs={snapshot('their_build')}
        mineValue={false}
        theirsValue={true}
      />,
    );

    await waitFor(() => expect(frame.mountGameFrame).toHaveBeenCalledTimes(2));
    expect(frame.options[0]).toMatchObject({ draftGrant: 'grant' });
    act(() => frame.options[0]?.onState?.({ bridgeState: 'ready', dropped: 0 }));
    act(() => frame.options[1]?.onState?.({ bridgeState: 'error', dropped: 0 }));

    expect(frame.controllers[0]?.select).toHaveBeenCalledWith(['entity_one']);
    expect(screen.getByLabelText('Mine')).toBeVisible();
    expect(screen.getByText('Theirs preview unavailable: true')).toBeVisible();

    view.unmount();
    expect(frame.controllers[0]?.dispose).toHaveBeenCalledOnce();
    expect(frame.controllers[1]?.dispose).toHaveBeenCalledOnce();
  });
});
