import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { api } from '../../lib/api/client';
import { pushToast } from '../../lib/notify/slice';
import { shareInvite } from './share';
import { InviteButton } from './InviteButton';

vi.mock('../../lib/api/client', () => ({ api: vi.fn() }));
vi.mock('../../lib/notify/slice', () => ({ pushToast: vi.fn() }));
vi.mock('./share', () => ({ shareInvite: vi.fn() }));

const mockedApi = vi.mocked(api);
const mockedToast = vi.mocked(pushToast);
const mockedShare = vi.mocked(shareInvite);

beforeEach(() => {
  mockedApi.mockReset();
  mockedToast.mockReset();
  mockedShare.mockReset();
  mockedShare.mockResolvedValue({ method: 'copy' });
});

afterEach(() => cleanup());

it('reports room creation failures and restores the control', async () => {
  mockedApi.mockRejectedValueOnce(new Error('offline'));
  render(<InviteButton branchId="main" buildId="build" gameId="game" />);

  fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

  await waitFor(() => expect(mockedToast).toHaveBeenCalledWith('Could not share invite'));
  expect(screen.getByRole('button', { name: 'Invite' })).toBeEnabled();
});

it('creates a per-seat room when the game declares per-seat authority', async () => {
  mockedApi.mockResolvedValueOnce({ roomId: 'room-1', grant: 'grant', pin: {}, roomsUrl: 'ws://rooms.test' });
  mockedApi.mockResolvedValueOnce({ url: 'https://maker.test/join/one' });
  render(<InviteButton branchId="main" buildId="build" gameId="game" authorityMode="per-seat" />);
  fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
  await waitFor(() =>
    expect(mockedApi).toHaveBeenCalledWith(
      '/games/game/rooms',
      expect.objectContaining({
        json: expect.objectContaining({ mode: 'per-seat' }),
      }),
    ),
  );
});

it('reports share failures after creating the invite', async () => {
  mockedApi
    .mockResolvedValueOnce({
      roomId: 'room-1',
      grant: 'memory-only',
      pin: { gameId: 'game', branchId: 'main', buildId: 'build' },
      roomsUrl: 'wss://rooms.test',
    })
    .mockResolvedValueOnce({ url: 'https://maker.test/join/one' });
  mockedShare.mockRejectedValueOnce(new Error('share unavailable'));
  render(<InviteButton branchId="main" buildId="build" gameId="game" />);

  fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

  await waitFor(() => expect(mockedToast).toHaveBeenCalledWith('Could not share invite'));
  expect(screen.queryByText('Copied')).not.toBeInTheDocument();
});

it('creates one room, requests a fresh link per press, and confirms copied links', async () => {
  const created = {
    roomId: 'room-1',
    grant: 'memory-only',
    pin: { gameId: 'game', branchId: 'main', buildId: 'build' },
    roomsUrl: 'wss://rooms.test',
  };
  mockedApi
    .mockResolvedValueOnce(created)
    .mockResolvedValueOnce({ url: 'https://maker.test/join/one' })
    .mockResolvedValueOnce({ url: 'https://maker.test/join/two' });
  const onRoomCreated = vi.fn();
  render(<InviteButton branchId="main" buildId="build" gameId="game" onRoomCreated={onRoomCreated} />);

  const invite = screen.getByRole('button', { name: 'Invite' });
  expect(invite).toHaveTextContent('↗');
  fireEvent.click(invite);
  await screen.findByText('Copied');
  fireEvent.click(invite);
  await waitFor(() => expect(mockedShare).toHaveBeenCalledTimes(2));

  expect(mockedApi).toHaveBeenCalledWith('/games/game/rooms', {
    method: 'POST',
    json: { branchId: 'main', buildId: 'build', maxPlayers: 4, protocol: 2 },
  });
  expect(mockedApi).toHaveBeenCalledWith('/rooms/room-1/invites', { method: 'POST', json: {} });
  expect(mockedApi.mock.calls.filter(([path]) => path === '/games/game/rooms')).toHaveLength(1);
  expect(onRoomCreated).toHaveBeenCalledWith(created);
});
