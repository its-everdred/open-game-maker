import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameCommand } from '@ogm/contracts';

import { markSent, resetReviewDrafts } from '../../features/commands-inbox/drafts';
import { ShortReviewScreen } from './ReviewScreen';

const command: GameCommand = {
  job_id: 'j_1',
  ticket: '57',
  title: 'Pick a hero',
  checkpoint_id: 'cp_1',
  decision_id: 'd_1',
  version: 1,
  question: 'Which hero look?',
  options: [
    { id: 'knight', label: 'Knight', media: { url: 'https://media.example.test/k.png', width: 8, height: 8 } },
    { id: 'theme', label: 'Theme', media: { url: 'https://media.example.test/t.png', width: 8, height: 8 } },
  ],
  blocking: false,
  opened_at: '2026-11-08T10:00:00.000Z',
  review_number: 1,
};

const state = { commands: [command] as GameCommand[], isFetching: false };
const voice = { mounts: 0, unmounts: 0, targets: [] as unknown[] };

vi.mock('../play/api', () => ({
  usePlayLink: () => ({ data: { id: 'g_1', slug: 'blobs' }, isError: false }),
  playLinkDenial: () => 'missing',
}));
vi.mock('../../features/commands-inbox/commands', () => ({
  gameCommandsQueryKey: (gameId: string) => ['game-commands', gameId],
  useGameCommands: () => ({ commands: state.commands, isPending: false, isFetching: state.isFetching }),
}));
vi.mock('../../features/build-chat/jobs', () => ({
  useMyJobs: () => ({
    jobs: [{ id: 'j_1', gameId: 'g_1', aiurIssueNumber: 57, creatorId: 'u_1' }],
  }),
}));
// The voice call itself is covered in decision-voice.test.tsx; here it only reports a live call and whether it was
// ever unmounted, which is what hangs a real call up.
vi.mock('../../features/commands-inbox/decision-voice', () => ({
  useDucking: () => undefined,
  DecisionVoice: ({ target, onLive }: { target: unknown; onLive(live: boolean): void }) => {
    useEffect(() => {
      voice.mounts += 1;
      voice.targets.push(target);
      onLive(true);
      return () => {
        voice.unmounts += 1;
      };
    }, []);
    return <button aria-label="End voice" type="button" />;
  },
}));
vi.mock('../../features/commands-inbox/ReviewDeck', () => ({
  ReviewDeck: ({ onAnswered }: { onAnswered(): void }) => (
    <button onClick={onAnswered} type="button">
      Choose
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  resetReviewDrafts();
  state.commands = [command];
  state.isFetching = false;
  voice.mounts = 0;
  voice.unmounts = 0;
  voice.targets = [];
});

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/blobs/review/1']}>
      <Routes>
        <Route path="/:slug/review/:number" element={<ShortReviewScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the decision screen with voice', () => {
  // Kevin (#597): the voice agent is briefed on this decision, so the call names it.
  it('opens voice about this decision', () => {
    renderScreen();
    expect(voice.targets).toEqual([expect.objectContaining({ job_id: 'j_1', ticket: '57', command_id: 'd_1' })]);
  });

  // A spoken choice is saved by the agent; the screen sees the decision leave the open list. It must say Saved without
  // hanging up the call the creator is still in.
  it('shows Saved after a spoken choice and keeps the call', () => {
    const view = renderScreen();

    state.commands = [];
    view.rerender(
      <MemoryRouter initialEntries={['/blobs/review/1']}>
        <Routes>
          <Route path="/:slug/review/:number" element={<ShortReviewScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Saved' })).toBeVisible();
    expect(voice.unmounts).toBe(0);

    // The next spoken turn refetches the Commands; Saved holds and the call stays up.
    state.isFetching = true;
    view.rerender(
      <MemoryRouter initialEntries={['/blobs/review/1']}>
        <Routes>
          <Route path="/:slug/review/:number" element={<ShortReviewScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Saved' })).toBeVisible();
    expect(voice.unmounts).toBe(0);

    // Change reopens the same decision even though it is no longer in the open list.
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Change' })));
    expect(screen.getByRole('heading', { name: 'Pick a hero' })).toBeVisible();
    expect(voice.unmounts).toBe(0);
  });

  it('shows Saved after a clicked answer', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(screen.getByRole('heading', { name: 'Saved' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Change' })).toBeVisible();
  });

  // An answer sent earlier stays sent in the device's drafts. Changing it must open the deck again, not leave the
  // creator on Saved with no way to correct it.
  it('changes an answer sent on an earlier visit', () => {
    markSent(command);
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Saved' })).toBeVisible();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Change' })));
    expect(screen.getByRole('heading', { name: 'Pick a hero' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose' })).toBeVisible();
    // Leaving before a new answer goes out keeps the question answered.
    cleanup();
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Saved' })).toBeVisible();
  });

  // A registered game's own Command has no job to tell, and its aiur cannot take a changed answer.
  it('offers no Change for a Command with no job', () => {
    state.commands = [{ ...command, job_id: null }];
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(screen.getByRole('heading', { name: 'Saved' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });
});
