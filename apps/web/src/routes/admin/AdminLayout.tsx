import { useEffect } from 'react';
import { Navigate, NavLink, Outlet } from 'react-router';

import { useAdminMe } from './api';
import { requireAdmin } from './guard';
import { registerAdminTestApi } from './test-state';
import './admin.css';
import './admin-mobile.css';

const links = [
  ['.', 'Oversight'],
  ['members', 'Members'],
  ['invites', 'Invites'],
  ['users', 'Users'],
  ['budgets', 'Budgets'],
  ['energy', 'Minerals and Gas'],
  ['builds', 'Builds'],
  ['intake', 'Intake'],
] as const;

export function AdminLayout() {
  const me = useAdminMe();

  useEffect(registerAdminTestApi, []);

  if (me.isPending) return <p className="admin-state">Loading admin…</p>;
  if (me.isError) return <p className="admin-state">Not allowed</p>;
  if (requireAdmin(me.data) === 'redirect') return <Navigate replace to="/all" />;

  return (
    <div className="admin-shell">
      <header className="admin-head">
        <p className="admin-kicker">{me.data.family?.name ?? 'Family'}</p>
        <h1>Admin</h1>
      </header>
      <nav aria-label="Admin sections" className="admin-nav">
        {links.map(([to, label]) => (
          <NavLink key={to} end={to === '.'} to={to}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="admin-content">
        <Outlet />
      </div>
    </div>
  );
}
