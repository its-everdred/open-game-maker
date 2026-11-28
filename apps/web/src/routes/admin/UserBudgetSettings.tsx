import { useMutation } from '@tanstack/react-query';

import { adminKeys, adminRequest, invalidateAdmin, useAllowedUsers } from './api';
import { GameplaySetting } from './GameplaySetting';
import { WeeklyBudget } from './WeeklyBudget';
import type { AdminAllowedUser } from './types';

export function UserBudgetSettings() {
  const users = useAllowedUsers();
  const budget = useMutation({
    mutationFn: ({
      user,
      value,
    }: {
      user: AdminAllowedUser;
      value: { newGames: number | null; edits: number | null };
    }) => adminRequest(`/admin/users/${encodeURIComponent(user.email)}/weekly-budget`, { method: 'PUT', json: value }),
    onSuccess: () => invalidateAdmin(adminKeys.users()),
  });
  return (
    <section>
      <GameplaySetting />
      <h3>Weekly user budgets</h3>
      {users.isError && <p role="alert">Couldn’t load users.</p>}
      {users.data?.users.map((user) => (
        <div className="admin-card" key={user.email}>
          <p>{user.name || user.email}</p>
          <WeeklyBudget
            key={`${user.email}:${user.role}:${JSON.stringify(user.weeklyBudget)}`}
            user={user}
            busy={budget.isPending}
            onSave={(target, value) => budget.mutate({ user: target, value })}
          />
        </div>
      ))}
      {budget.isError && <p role="alert">Budget could not be saved. Try again.</p>}
    </section>
  );
}
