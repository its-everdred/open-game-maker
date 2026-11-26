import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { adminKeys, adminRequest, invalidateAdmin, useAdminBuilds } from './api';
import { ConfirmDialog } from './ConfirmDialog';
import type { AdminGame } from './types';

type Action = { kind: 'delist' | 'flag' | 'release' | 'coming_soon' | 'grant'; game: AdminGame };

export function Oversight() {
  const data = useAdminBuilds();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState<'spam' | 'harmful' | 'other'>('harmful');
  const [email, setEmail] = useState('');
  const delist = useMutation({
    mutationFn: (gameId: string) =>
      adminRequest(`/admin/games/${encodeURIComponent(gameId)}/delist`, { method: 'POST' }),
    onSuccess: async () => {
      await invalidateAdmin(adminKeys.builds());
      setAction(null);
    },
  });
  const flag = useMutation({
    mutationFn: (gameId: string) =>
      adminRequest(`/admin/games/${encodeURIComponent(gameId)}/flag-abuse`, { method: 'POST', json: { reason } }),
    onSuccess: async () => {
      await invalidateAdmin(adminKeys.builds());
      setAction(null);
    },
  });
  const release = useMutation({
    mutationFn: (value: { gameId: string; releaseState: 'released' | 'coming_soon' }) =>
      adminRequest(`/games/${encodeURIComponent(value.gameId)}`, {
        method: 'PATCH',
        json: { releaseState: value.releaseState },
      }),
    onSuccess: async () => {
      await invalidateAdmin(adminKeys.builds());
      setAction(null);
    },
  });
  const grant = useMutation({
    mutationFn: (gameId: string) =>
      adminRequest(`/admin/games/${encodeURIComponent(gameId)}/early-access`, {
        method: 'POST',
        json: { email },
      }),
    onSuccess: () => {
      setAction(null);
      setEmail('');
    },
  });
  const activeMutation =
    action?.kind === 'delist' ? delist : action?.kind === 'flag' ? flag : action?.kind === 'grant' ? grant : release;
  const openAction = (next: Action) => {
    delist.reset();
    flag.reset();
    release.reset();
    grant.reset();
    setAction(next);
  };
  const confirm = () => {
    if (!action || activeMutation.isPending) return;
    if (action.kind === 'delist') delist.mutate(action.game.id);
    else if (action.kind === 'flag') flag.mutate(action.game.id);
    else if (action.kind === 'grant') {
      if (email) grant.mutate(action.game.id);
    } else
      release.mutate({ gameId: action.game.id, releaseState: action.kind === 'release' ? 'released' : 'coming_soon' });
  };

  if (data.isPending) return <p className="admin-state">Loading games…</p>;
  if (data.isError) return <p className="admin-state">Not allowed</p>;
  const latest = new Map<string, (typeof data.data.builds)[number]>();
  for (const build of data.data.builds) if (!latest.has(build.game.id)) latest.set(build.game.id, build);
  const owners = new Map(data.data.members.map((member) => [member.userId, member.email]));

  return (
    <section>
      <p className="admin-kicker">Family</p>
      <h2>Game oversight</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Game</th>
              <th scope="col">Owner</th>
              <th scope="col">Visibility</th>
              <th scope="col">Published version</th>
              <th scope="col">Last build</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.data.games.map((game) => (
              <tr key={game.id}>
                <td data-label="Game">{game.title}</td>
                <td data-label="Owner">{owners.get(game.ownerId) ?? 'Unknown'}</td>
                <td data-label="Visibility">{game.delistedAt ? 'delisted' : game.visibility}</td>
                <td data-label="Published version">Unknown</td>
                <td data-label="Last build">{latest.get(game.id)?.job.state ?? 'No builds'}</td>
                <td data-label="Actions">
                  <div className="admin-row-actions">
                    <button
                      className="admin-secondary tap-secondary"
                      type="button"
                      onClick={() =>
                        openAction({ kind: game.releaseState === 'coming_soon' ? 'release' : 'coming_soon', game })
                      }
                    >
                      {game.releaseState === 'coming_soon' ? 'Release' : 'Coming Soon'}
                    </button>
                    {game.releaseState === 'coming_soon' && (
                      <button
                        className="admin-secondary tap-secondary"
                        type="button"
                        onClick={() => openAction({ kind: 'grant', game })}
                      >
                        Grant access
                      </button>
                    )}
                    {!game.delistedAt ? (
                      <button
                        className="admin-secondary tap-primary"
                        type="button"
                        disabled={delist.isPending || flag.isPending}
                        onClick={() => openAction({ kind: 'delist', game })}
                      >
                        Delist
                      </button>
                    ) : null}
                    <button
                      className="admin-secondary tap-secondary"
                      disabled={delist.isPending || flag.isPending}
                      type="button"
                      onClick={() => openAction({ kind: 'flag', game })}
                    >
                      Flag abuse
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {action ? (
        <ConfirmDialog
          busy={activeMutation.isPending}
          error={activeMutation.isError ? 'Change could not be saved. Try again.' : undefined}
          title={
            action.kind === 'delist'
              ? 'Delist this game?'
              : action.kind === 'flag'
                ? 'Flag this game?'
                : action.kind === 'grant'
                  ? 'Grant early access?'
                  : action.kind === 'release'
                    ? 'Release this game?'
                    : 'Mark Coming Soon?'
          }
          onCancel={() => setAction(null)}
          onConfirm={confirm}
        >
          <p>{action.game.title}</p>
          {action.kind === 'grant' && (
            <label>
              Tester email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
          )}
          {action.kind === 'flag' ? (
            <label>
              Reason
              <select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>
                <option value="spam">Spam</option>
                <option value="harmful">Harmful</option>
                <option value="other">Other</option>
              </select>
            </label>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
