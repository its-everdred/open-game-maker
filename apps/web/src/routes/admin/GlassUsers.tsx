import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AdminAllowedUser, AllowListRole } from './types';
import kit from '../glass-kit.module.css';
import '../games/game-access.css';
import './glass-users.css';

const roles: AllowListRole[] = ['player', 'maker', 'admin'];
const label = (role: AllowListRole) => (role === 'maker' ? 'Editor' : role === 'admin' ? 'Admin' : 'Player');
const name = (user: AdminAllowedUser) => user.name || user.email;
const hasJoined = (user: AdminAllowedUser) => user.name != null || user.lastSignInAt !== null;

function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

export function GlassUsers({
  users,
  currentEmail,
  busy,
  error,
  onInvite,
  onChange,
  onRemove,
  onResend,
}: {
  users: AdminAllowedUser[];
  currentEmail: string;
  busy: boolean;
  error?: string;
  onInvite(email: string, role: AllowListRole): Promise<unknown>;
  onChange(user: AdminAllowedUser, role: AllowListRole): Promise<unknown>;
  onRemove(user: AdminAllowedUser): void;
  onResend(user: AdminAllowedUser): void;
}) {
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);
  const [selected, setSelected] = useState<AdminAllowedUser | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => previous?.focus();
  }, [selected]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AllowListRole>('player');
  const active = users.filter(hasJoined);
  const invited = users.filter((user) => !hasJoined(user));
  const openUser = (user: AdminAllowedUser) => {
    setSelected(user);
    setRole(user.role);
  };
  const close = () => {
    setInviting(false);
    setSelected(null);
    setRole('player');
  };
  const segment = (
    <div className="game-access-segment glass-users-segment" role="group" aria-label="Type">
      {roles.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={role === value}
          disabled={busy || (!!selected && selected.email === currentEmail)}
          onClick={() => setRole(value)}
        >
          {label(value)}
        </button>
      ))}
    </div>
  );
  return (
    <div className={`${kit.g} game-access glass-users`}>
      <div className={`${kit.glows} game-access-glows`} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className={`${kit.top} game-access-top`}>
        <button
          className={`${kit.orb} ${kit.sm} game-access-back`}
          type="button"
          onClick={() => (inviting ? close() : navigate('/admin'))}
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
        <h1 className={kit.h1}>{inviting ? 'Invite' : 'Admin'}</h1>
        {!inviting && (
          <button
            type="button"
            className={`${kit.orb} ${kit.sm} game-access-back glass-users-add`}
            aria-label="Invite user"
            onClick={() => {
              setRole('player');
              setInviting(true);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>
      {inviting ? (
        <form
          className="game-access-body glass-users-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onInvite(email.trim(), role)
              .then(() => {
                setEmail('');
                close();
              })
              .catch(() => {});
          }}
        >
          <div className="game-access-card">
            <label className="glass-users-input">
              <MailIcon />
              <input
                type="email"
                placeholder="Email"
                aria-label="Email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <div className="glass-users-segment-wrap">{segment}</div>
          </div>
          {error && <p role="alert">{error}</p>}
          <button className="glass-users-primary" type="submit" disabled={busy}>
            Send invite
          </button>
        </form>
      ) : (
        <div className="game-access-body">
          <nav className={`${kit.seg} glass-users-tabs`} aria-label="Admin sections">
            <button type="button" aria-pressed="true">
              Users
            </button>
            <button type="button" onClick={() => navigate('/admin/budgets')}>
              Resources
            </button>
            <button type="button" onClick={() => navigate('/admin/builds')}>
              Work
            </button>
            <button type="button" onClick={() => navigate('/admin/intake')}>
              Intake
            </button>
          </nav>
          {[
            ['Users', active],
            ['Invited', invited],
          ].map(([heading, group]) => {
            const rows = group as AdminAllowedUser[];
            if (!rows.length) return null;
            return (
              <section key={heading as string}>
                <div className={`${kit.cap} game-access-caption`}>
                  {heading as string} <span className={kit.cnt}>{rows.length}</span>
                </div>
                <div className="game-access-card">
                  {rows.map((user) => (
                    <button
                      className="game-access-row glass-users-row"
                      type="button"
                      key={user.email}
                      onClick={() => openUser(user)}
                    >
                      <span className="game-access-avatar">
                        {hasJoined(user) ? (
                          name(user).charAt(0).toUpperCase()
                        ) : (
                          <svg
                            viewBox="0 0 24 24"
                            width="20"
                            height="20"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                            <path d="M3 7l9 6 9-6" />
                          </svg>
                        )}
                      </span>
                      <span className="game-access-name">
                        <span>{name(user)}</span>
                        <small>
                          {!hasJoined(user) ? 'Invited · ' : ''}
                          {label(user.role)}
                        </small>
                      </span>
                      <span aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      {!inviting && (
        <form
          className="glass-users-landscape-invite"
          onSubmit={(event) => {
            event.preventDefault();
            void onInvite(email.trim(), role)
              .then(() => {
                setEmail('');
                setRole('player');
              })
              .catch(() => {});
          }}
        >
          <div className="game-access-caption">Invite</div>
          <div className="game-access-card">
            <label className="glass-users-input">
              <MailIcon />
              <input
                type="email"
                placeholder="Email"
                aria-label="Email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <div className="glass-users-segment-wrap">{segment}</div>
          </div>
          <button className="glass-users-primary" type="submit" disabled={busy}>
            Send invite
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      {selected && (
        <>
          <div className="glass-users-scrim" onClick={close} />
          <div
            ref={sheet}
            className="glass-users-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={name(selected)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
              if (event.key !== 'Tab') return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              );
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
            <span className="game-access-avatar glass-users-large">{name(selected).charAt(0).toUpperCase()}</span>
            <h2>{name(selected)}</h2>
            {segment}
            {error && <p role="alert">{error}</p>}
            <button
              type="button"
              className="glass-users-primary"
              disabled={busy}
              onClick={() => {
                void onChange(selected, role)
                  .then(close)
                  .catch(() => {});
              }}
            >
              Done
            </button>
            {!hasJoined(selected) && (
              <button type="button" className="glass-users-remove" disabled={busy} onClick={() => onResend(selected)}>
                Resend invite
              </button>
            )}
            {selected.email !== currentEmail && (
              <button
                type="button"
                className="glass-users-remove"
                disabled={busy}
                onClick={() => {
                  onRemove(selected);
                  close();
                }}
              >
                Remove user
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
