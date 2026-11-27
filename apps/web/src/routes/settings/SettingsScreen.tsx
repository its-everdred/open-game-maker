import { Link, Outlet } from 'react-router';

import { currentBuild } from '../../app/app-version';

import './settings.css';

export function SettingsScreen() {
  return (
    <div className="settings-screen">
      <header>
        <h1>Settings</h1>
        <nav>
          <Link className="tap-secondary" to="/settings/energy">
            Minerals and Gas
          </Link>
          <Link className="tap-secondary" to="/settings/credits">
            Credits
          </Link>
        </nav>
      </header>
      <Outlet />
      <p className="settings-build">{currentBuild() ?? 'dev'}</p>
    </div>
  );
}
