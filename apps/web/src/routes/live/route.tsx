import type { ScreenRoute } from '../../app/screen';
import { LiveScreen } from './LiveScreen';

export const route: ScreenRoute = {
  path: '/live/:slug/:ticket',
  element: <LiveScreen />,
  chrome: 'bare',
  auth: 'required',
};
