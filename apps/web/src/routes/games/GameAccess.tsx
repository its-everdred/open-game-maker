import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { api } from '../../lib/api/client';
import kit from '../glass-kit.module.css';
import './game-access.css';

type Access = 'hide' | 'play' | 'edit';
type User = {
  email: string;
  name: string | null;
  userId: string | null;
  role: 'player' | 'maker' | 'admin';
  access: Access;
};
const name = (user: User) => user.name || user.email;
const landscapeQuery = '(orientation: landscape) and (max-height: 600px)';
function subscribeLandscape(callback: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(landscapeQuery);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}
function landscapeSnapshot() {
  return typeof window.matchMedia === 'function' && window.matchMedia(landscapeQuery).matches;
}

function Owner({ user }: { user: User }) {
  return (
    <div className="game-access-card">
      <div className="game-access-row">
        <span className="game-access-avatar">{name(user).charAt(0).toUpperCase()}</span>
        <div className="game-access-name">
          <div>{name(user)}</div>
          <small>Owner</small>
        </div>
      </div>
    </div>
  );
}

function Users({ users, busy, change }: { users: User[]; busy: boolean; change(email: string, access: Access): void }) {
  return (
    <div className="game-access-card">
      {users.map((user) => (
        <div className="game-access-row" key={user.email}>
          <span className="game-access-avatar">{name(user).charAt(0).toUpperCase()}</span>
          <div className="game-access-name">
            <div>{name(user)}</div>
            <small>{user.role === 'maker' ? 'Editor' : user.role === 'admin' ? 'Admin' : 'Player'}</small>
          </div>
          <div className="game-access-segment" role="group" aria-label={`${name(user)} access`}>
            {(['hide', 'play', 'edit'] as const).map((access) => (
              <button
                key={access}
                type="button"
                aria-pressed={user.access === access}
                disabled={busy || (access === 'edit' && user.role === 'player')}
                onClick={() => change(user.email, access)}
              >
                {access.charAt(0).toUpperCase() + access.slice(1)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GameAccess({ gameId, ownerId, onClose }: { gameId: string; ownerId: string; onClose(): void }) {
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    back.current?.focus();
    return () => previous?.focus();
  }, []);
  const landscape = useSyncExternalStore(subscribeLandscape, landscapeSnapshot, () => false);
  const path = `/games/${encodeURIComponent(gameId)}/access`;
  const users = useQuery({
    queryKey: ['game-access', gameId],
    queryFn: () => api<{ users: User[] }>(path),
    retry: false,
  });
  const update = useMutation({
    mutationFn: ({ email, access }: { email: string; access: Access }) =>
      api(`${path}/${encodeURIComponent(email)}`, { method: 'PUT', json: { access } }),
    onSuccess: () => users.refetch(),
  });
  const owner = users.data?.users.find((user) => user.userId === ownerId);
  const others = users.data?.users.filter((user) => user.userId !== ownerId) ?? [];
  const change = (email: string, access: Access) => update.mutate({ email, access });
  return (
    <div
      className={`${kit.g} game-access`}
      role="dialog"
      aria-modal="true"
      aria-label="Access"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
        if (event.key !== 'Tab') return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        if (!buttons.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault();
          buttons.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
          event.preventDefault();
          buttons[0]?.focus();
        }
      }}
    >
      <div className={`${kit.glows} game-access-glows`} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className={`${kit.top} game-access-top`}>
        <button
          ref={back}
          className={`${kit.orb} ${kit.sm} game-access-back`}
          type="button"
          onClick={onClose}
          aria-label="Back"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className={kit.h1}>Access</h1>
      </div>
      <div className="game-access-body">
        {users.isPending && <p>Loading…</p>}
        {users.isError && <p role="alert">Couldn’t load access.</p>}
        {users.data &&
          (landscape ? (
            <div className="game-access-landscape">
              <div>
                {owner && <Owner user={owner} />}
                {others.length > 0 && <Users users={others.slice(0, 1)} busy={update.isPending} change={change} />}
              </div>
              <div>
                {others.length > 1 && <Users users={others.slice(1)} busy={update.isPending} change={change} />}
              </div>
            </div>
          ) : (
            <div className="game-access-portrait">
              {owner && <Owner user={owner} />}
              <section>
                <div className={`${kit.cap} game-access-caption`}>
                  Users <span className={kit.cnt}>{others.length}</span>
                </div>
                {others.length > 0 && <Users users={others} busy={update.isPending} change={change} />}
              </section>
            </div>
          ))}
        {update.isError && <p role="alert">Couldn’t change access.</p>}
      </div>
    </div>
  );
}
