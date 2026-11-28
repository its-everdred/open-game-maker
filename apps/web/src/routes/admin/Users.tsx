import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { adminKeys, adminRequest, invalidateAdmin, useAllowedUsers, useAdminMe } from './api';
import { ConfirmDialog } from './ConfirmDialog';
import { GlassUsers } from './GlassUsers';
import { WeeklyBudget } from './WeeklyBudget';
import type { AdminAllowedUser, AllowListRole } from './types';

const ROLES: AllowListRole[] = ['player', 'maker', 'admin'];

type Pending = { kind: 'remove'; user: AdminAllowedUser };

function roleLabel(role: AllowListRole): string {
  if (role === 'maker') return 'Editor';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// Built once: the first default-locale formatter construction is the expensive one.
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' });

function lastSignIn(user: AdminAllowedUser): string {
  return user.lastSignInAt ? dateOnly.format(new Date(user.lastSignInAt)) : 'Never';
}

export function Users() {
  const me = useAdminMe();
  const users = useAllowedUsers();
  const [pending, setPending] = useState<Pending | null>(null);
  const add = useMutation({
    mutationFn: (value: { email: string; role: AllowListRole }) =>
      adminRequest('/admin/users', { method: 'POST', json: value }),
    onSuccess: () => invalidateAdmin(adminKeys.users()),
  });
  const changeRole = useMutation({
    mutationFn: ({ user, role }: { user: AdminAllowedUser; role: AllowListRole }) =>
      adminRequest(`/admin/users/${encodeURIComponent(user.email)}`, { method: 'PATCH', json: { role } }),
    onSuccess: () => invalidateAdmin(adminKeys.users()),
  });
  const remove = useMutation({
    mutationFn: (user: AdminAllowedUser) =>
      adminRequest(`/admin/users/${encodeURIComponent(user.email)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await invalidateAdmin(adminKeys.users());
      setPending(null);
    },
  });
  const invite = useMutation({
    mutationFn: (user: AdminAllowedUser) =>
      adminRequest(`/admin/users/${encodeURIComponent(user.email)}/invite`, { method: 'POST', json: {} }),
  });
  if (users.isPending || me.isPending) return <p className="admin-state">Loading users…</p>;
  if (users.isError || me.isError) return <p className="admin-state">Not allowed</p>;
  return (
    <>
      <GlassUsers
        users={users.data.users}
        currentEmail={me.data.user.email.toLowerCase()}
        busy={add.isPending || changeRole.isPending || remove.isPending || invite.isPending}
        error={
          add.isError
            ? addError(add.error)
            : changeRole.isError || invite.isError
              ? 'Change could not be saved. Try again.'
              : undefined
        }
        onInvite={(email, role) => add.mutateAsync({ email, role })}
        onChange={(user, role) => (user.role === role ? Promise.resolve() : changeRole.mutateAsync({ user, role }))}
        onResend={(user) => invite.mutate(user)}
        onRemove={(user) => {
          remove.reset();
          setPending({ kind: 'remove', user });
        }}
      />
      {pending && (
        <ConfirmDialog
          busy={remove.isPending}
          error={remove.isError ? 'Change could not be saved. Try again.' : undefined}
          title="Remove user?"
          onCancel={() => setPending(null)}
          onConfirm={() => remove.mutate(pending.user)}
        >
          <p>{pending.user.email}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

export function UsersTable({
  busy = false,
  currentEmail,
  budgetFailed = false,
  onSaveBudget = () => {},
  inviteFailed = false,
  roleFailed = false,
  users,
  onChangeRole,
  onInvite,
  onRemove,
}: {
  busy?: boolean;
  currentEmail: string;
  budgetFailed?: boolean;
  onSaveBudget?(user: AdminAllowedUser, budget: { newGames: number | null; edits: number | null }): void;
  inviteFailed?: boolean;
  roleFailed?: boolean;
  users: AdminAllowedUser[];
  onChangeRole(user: AdminAllowedUser, role: AllowListRole): void;
  onInvite(user: AdminAllowedUser): void;
  onRemove(user: AdminAllowedUser): void;
}) {
  return (
    <>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Weekly budget</th>
              <th scope="col">Last sign-in</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const self = user.email === currentEmail;
              return (
                <tr key={user.email}>
                  <td data-label="Email">{user.email}</td>
                  <td data-label="Role">
                    <select
                      aria-label={`Role for ${user.email}`}
                      disabled={self || busy}
                      value={user.role}
                      onChange={(event) => onChangeRole(user, event.target.value as AllowListRole)}
                    >
                      {ROLES.map((value) => (
                        <option key={value} value={value}>
                          {roleLabel(value)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Weekly budget">
                    <WeeklyBudget
                      key={`${user.email}:${user.role}:${JSON.stringify(user.weeklyBudget)}`}
                      user={user}
                      busy={busy}
                      onSave={onSaveBudget}
                    />
                  </td>
                  <td data-label="Last sign-in">{lastSignIn(user)}</td>
                  <td data-label="Actions">
                    <div className="admin-row-actions">
                      <button
                        className="admin-secondary tap-secondary"
                        disabled={busy}
                        type="button"
                        onClick={() => onInvite(user)}
                      >
                        Resend invite
                      </button>
                      {self ? null : (
                        <button
                          aria-label={`Remove ${user.email}`}
                          className="admin-secondary tap-secondary"
                          disabled={busy}
                          type="button"
                          onClick={() => onRemove(user)}
                        >
                          Remove user
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {budgetFailed ? <p role="alert">Budget could not be saved. Try again.</p> : null}
      {roleFailed ? (
        <p className="admin-dialog-error" role="alert">
          Role could not be changed. Try again.
        </p>
      ) : null}
      {inviteFailed ? (
        <p className="admin-dialog-error" role="alert">
          Invite could not be sent. Try again.
        </p>
      ) : null}
    </>
  );
}

function addError(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
  if (status === 409) return 'That address is already on the list.';
  return 'User could not be added. Try again.';
}
