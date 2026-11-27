import type { ScreenRoute } from '../../app/screen';
import { Navigate } from 'react-router';
import { useSession } from '../../lib/api/session';
import { useAdminMe } from '../admin/api';
import { NewGameScreen } from './NewGameScreen';

function MakerScreen() {
  const { data: session } = useSession();
  const me = useAdminMe(Boolean(session));
  if (me.isPending) return null;
  if (me.data?.user?.id !== session?.user?.id || me.data?.capability !== 'creator')
    return <Navigate to="/all" replace />;
  return <NewGameScreen />;
}

export const route: ScreenRoute = {
  path: '/new',
  element: <MakerScreen />,
  chrome: 'app',
  auth: 'required',
};
