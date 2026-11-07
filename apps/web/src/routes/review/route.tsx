import type { ScreenRoute } from '../../app/screen';
import { ReviewScreen } from './ReviewScreen';

// The review deck's deep link (A3): one screen per Command so the Executor can push the creator a single link. The
// game's own screens live under `/g/:gameId`; the ticket's link is written `/game/<id>/review/<command>`, so that is
// the path here and the screen sends the creator back to the game's inbox when the review is in.
export const route: ScreenRoute = {
  path: '/game/:gameId/review/:commandId',
  element: <ReviewScreen />,
  chrome: 'app',
  auth: 'required',
};
