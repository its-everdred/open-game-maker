import type { ScreenRoute } from '../../app/screen';
import { LegacyReviewScreen } from './ReviewScreen';

// The review deck's first deep link (A3), `/game/<id>/review/<command>`. Links already sent keep working: the screen
// moves them to the short `/<slug>/review/<n>` form (#591).
export const route: ScreenRoute = {
  path: '/game/:gameId/review/:commandId',
  element: <LegacyReviewScreen />,
  chrome: 'app',
  auth: 'required',
};
