import { useState } from 'react';
import type { AdminAllowedUser } from './types';

export function WeeklyBudget({
  user,
  busy,
  onSave,
}: {
  user: AdminAllowedUser;
  busy: boolean;
  onSave(user: AdminAllowedUser, budget: { newGames: number | null; edits: number | null }): void;
}) {
  const initial = user.weeklyBudget ?? { newGames: 2, edits: 20 };
  const [newGames, setNewGames] = useState(initial.newGames?.toString() ?? '');
  const [edits, setEdits] = useState(initial.edits?.toString() ?? '');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(user, {
          newGames: newGames === '' ? null : Number(newGames),
          edits: edits === '' ? null : Number(edits),
        });
      }}
    >
      <label>
        Interim new-game limit{' '}
        <input
          aria-label={`Weekly new games for ${user.email}`}
          type="number"
          placeholder="Unlimited"
          min="0"
          step="1"
          value={newGames}
          onChange={(event) => setNewGames(event.target.value)}
        />
      </label>
      <label>
        Interim edit limit{' '}
        <input
          aria-label={`Weekly edits for ${user.email}`}
          type="number"
          placeholder="Unlimited"
          min="0"
          step="1"
          value={edits}
          onChange={(event) => setEdits(event.target.value)}
        />
      </label>
      <button type="submit" disabled={busy}>
        Save
      </button>
    </form>
  );
}
