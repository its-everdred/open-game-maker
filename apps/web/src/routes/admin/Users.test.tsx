import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsersTable } from './Users';

const users = [
  {
    email: 'kevin@example.com',
    role: 'admin' as const,
    addedBy: 'env',
    addedAt: '2026-11-01T00:00:00.000Z',
    lastSignInAt: '2026-11-02T10:00:00.000Z',
  },
  {
    email: 'tester@example.com',
    role: 'player' as const,
    addedBy: 'u_1',
    addedAt: '2026-11-02T00:00:00.000Z',
    lastSignInAt: null,
  },
];

// The first render in a jsdom file carries the environment's cold-start cost (about 6 s on a slow host).
const FIRST_RENDER_MS = 20_000;

afterEach(() => {
  cleanup();
});

describe('allow-list user management', () => {
  it(
    'shows each role and last sign-in, and never offers to change or remove the caller',
    () => {
      const changeRole = vi.fn();
      const remove = vi.fn();
      render(
        <UsersTable
          currentEmail="kevin@example.com"
          users={users}
          onChangeRole={changeRole}
          onInvite={vi.fn()}
          onRemove={remove}
        />,
      );

      expect(screen.getByRole('combobox', { name: 'Role for kevin@example.com' })).toBeDisabled();
      expect(screen.getByText('Never').closest('tr')).toHaveTextContent('tester@example.com');
      expect(screen.queryByRole('button', { name: 'Remove kevin@example.com' })).not.toBeInTheDocument();

      fireEvent.change(screen.getByRole('combobox', { name: 'Role for tester@example.com' }), {
        target: { value: 'maker' },
      });
      expect(changeRole).toHaveBeenCalledWith(users[1], 'maker');

      fireEvent.click(screen.getByRole('button', { name: 'Remove tester@example.com' }));
      expect(remove).toHaveBeenCalledWith(users[1]);
    },
    FIRST_RENDER_MS,
  );

  it('saves weekly limits for a user, including unlimited', () => {
    const save = vi.fn();
    render(
      <UsersTable
        currentEmail="kevin@example.com"
        users={users}
        onChangeRole={vi.fn()}
        onInvite={vi.fn()}
        onRemove={vi.fn()}
        onSaveBudget={save}
      />,
    );
    fireEvent.change(screen.getByLabelText('Weekly new games for tester@example.com'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Weekly edits for tester@example.com'), { target: { value: '' } });
    const form = screen.getByLabelText('Weekly edits for tester@example.com').closest('form')!;
    fireEvent.submit(form);
    expect(save).toHaveBeenCalledWith(users[1], { newGames: 1, edits: null });
  });

  it('refreshes budget inputs when a role change updates the server defaults', () => {
    const props = {
      currentEmail: 'kevin@example.com',
      onChangeRole: vi.fn(),
      onInvite: vi.fn(),
      onRemove: vi.fn(),
      onSaveBudget: vi.fn(),
    };
    const { rerender } = render(<UsersTable {...props} users={users} />);
    expect(screen.getByLabelText('Weekly new games for tester@example.com')).toHaveValue(2);
    rerender(
      <UsersTable
        {...props}
        users={[users[0], { ...users[1], role: 'admin', weeklyBudget: { newGames: null, edits: null } }]}
      />,
    );
    expect(screen.getByLabelText('Weekly new games for tester@example.com')).toHaveValue(null);
    expect(screen.getByLabelText('Weekly edits for tester@example.com')).toHaveValue(null);
  });

  it('reports a failed invite resend', () => {
    render(
      <UsersTable
        currentEmail="kevin@example.com"
        inviteFailed
        users={users}
        onChangeRole={vi.fn()}
        onInvite={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Invite could not be sent.');
  });

  it('reports a failed role change', () => {
    render(
      <UsersTable
        currentEmail="kevin@example.com"
        roleFailed
        users={users}
        onChangeRole={vi.fn()}
        onInvite={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Role could not be changed.');
  });
});
