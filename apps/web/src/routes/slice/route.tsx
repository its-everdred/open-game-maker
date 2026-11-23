import type { ScreenRoute } from '../../app/screen';
import { SliceScreen } from './SliceScreen';

// One slice of a game, `/g/<gameId>/play?build=<buildId>&scenario=<name>`: that build, started in that scenario, with
// nothing around it. Review cards embed it; the editor stays at `/g/<gameId>` (#1281).
export const route: ScreenRoute = {
  path: '/g/:gameId/play',
  element: <SliceScreen />,
  chrome: 'bare',
  auth: 'required',
};
