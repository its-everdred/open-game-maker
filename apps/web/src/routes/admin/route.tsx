import type { ScreenRoute } from '../../app/screen';
import { EnergyAdmin } from '../../features/energy/EnergyAdmin';
import { AdminLayout } from './AdminLayout';
import { Budgets } from './Budgets';
import { Intake } from './Intake';
import { Invites } from './Invites';
import { Members } from './Members';
import { Oversight } from './Oversight';
import { Users } from './Users';
import { BuildDetail } from './builds/BuildDetail';
import { BuildsList } from './builds/BuildsList';

export const route: ScreenRoute = {
  path: '/admin',
  element: <AdminLayout />,
  chrome: 'app',
  auth: 'required',
  children: [
    { path: '', element: <Oversight /> },
    { path: 'members', element: <Members /> },
    { path: 'invites', element: <Invites /> },
    { path: 'users', element: <Users /> },
    { path: 'budgets', element: <Budgets /> },
    { path: 'energy', element: <EnergyAdmin /> },
    { path: 'builds', element: <BuildsList /> },
    { path: 'builds/:jobId', element: <BuildDetail /> },
    { path: 'intake', element: <Intake /> },
  ],
};
