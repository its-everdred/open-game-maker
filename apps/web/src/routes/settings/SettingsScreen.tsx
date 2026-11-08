import { Link, Outlet } from 'react-router';

import './settings.css';

export function SettingsScreen() {
  return (
    <div className="settings-screen">
      <header>
        <h1>Settings</h1>
        <nav>
          <Link className="tap-secondary" to="/settings/energy">
            Energy
          </Link>
          <Link className="tap-secondary" to="/settings/credits">
            Credits
          </Link>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
