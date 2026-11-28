import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

import { GlassUsers } from './GlassUsers';

it('invites an Editor and changes an existing user type', async () => {
  const onInvite = vi.fn().mockResolvedValue(undefined);
  const onChange = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <GlassUsers
        users={[
          {
            email: 'alexis@example.test',
            name: 'Alexis',
            role: 'maker',
            addedBy: 'owner',
            addedAt: '',
            lastSignInAt: '2026-01-01',
          },
        ]}
        currentEmail="owner@example.test"
        busy={false}
        onInvite={onInvite}
        onChange={onChange}
        onRemove={vi.fn()}
        onResend={vi.fn()}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Invite user' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.test' } });
  fireEvent.click(within(screen.getByRole('group', { name: 'Type' })).getByRole('button', { name: 'Editor' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
  await waitFor(() => expect(onInvite).toHaveBeenCalledWith('new@example.test', 'maker'));
  fireEvent.click(await screen.findByRole('button', { name: /Alexis/ }));
  const dialog = screen.getByRole('dialog', { name: 'Alexis' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Player' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ email: 'alexis@example.test' }), 'player'),
  );
});

it('keeps the landscape invite type independent and does not close a replacement user after a delayed save', async () => {
  let finish!: () => void;
  const onChange = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const users = ['Alexis', 'Sam'].map((name) => ({
    email: `${name.toLowerCase()}@example.test`,
    name,
    role: 'player' as const,
    addedBy: 'owner',
    addedAt: '',
    lastSignInAt: '2026-01-01',
  }));
  const { container } = render(
    <MemoryRouter>
      <GlassUsers
        users={users}
        currentEmail="owner@example.test"
        busy={false}
        onInvite={vi.fn()}
        onChange={onChange}
        onRemove={vi.fn()}
        onResend={vi.fn()}
      />
    </MemoryRouter>,
  );
  const invite = container.querySelector('.glass-users-landscape-invite') as HTMLElement;
  fireEvent.click(within(invite).getByRole('button', { name: 'Editor', hidden: true }));
  fireEvent.click(screen.getByRole('button', { name: /Alexis/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Alexis' })).getByRole('button', { name: 'Done' }));
  fireEvent.click(container.querySelector('.glass-users-scrim') as HTMLElement);
  fireEvent.click(screen.getByRole('button', { name: /Sam/ }));
  finish();
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sam' })).toBeInTheDocument());
  expect(within(invite).getByRole('button', { name: 'Editor', hidden: true })).toHaveAttribute('aria-pressed', 'true');
});
