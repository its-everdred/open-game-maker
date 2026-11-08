import type { ScreenRoute } from '../../app/screen';
import { EnergyScreen } from '../../features/energy/EnergyScreen';
import { CreditsScreen } from './CreditsScreen';
import { SettingsScreen } from './SettingsScreen';

export const route: ScreenRoute = {
  path: '/settings',
  element: <SettingsScreen />,
  children: [
    { path: 'credits', element: <CreditsScreen /> },
    { path: 'energy', element: <EnergyScreen /> },
  ],
  chrome: 'app',
  auth: 'required',
};
